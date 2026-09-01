/**
 * PDF and DOCX text extraction -- Node side.
 *
 * Moved out of GraphApiService when the renderer was sandboxed: pdfjs-dist's
 * legacy build and zlib.inflateRawSync are both Node-only, and running them in
 * main also removes globalThis.pdfjsWorker (a module-level global that used to
 * survive plugin unload) from the renderer entirely.
 */

const PDF_PAGE_BATCH_SIZE = 8;
const PDF_TIMEOUT_MS = 60_000;

interface PdfTextItem { str?: string; hasEOL?: boolean }

/**
 * We ship a bundle, not a file set, so pdf.js cannot fetch pdf.worker.mjs at runtime.
 * Registering WorkerMessageHandler on globalThis.pdfjsWorker before getDocument() is
 * pdf.js's own documented main-thread escape hatch: PDFWorker checks that global first
 * and uses it instead of importing GlobalWorkerOptions.workerSrc (never set). Intentional
 * -- one-shot text extraction needs no worker thread.
 */
function loadPdfJs(): { getDocument(args: unknown): { promise: Promise<PdfDocument> } } {
    const lib = require('pdfjs-dist/legacy/build/pdf.mjs');
    const scope = globalThis as { pdfjsWorker?: unknown };
    if (!scope.pdfjsWorker) {
        scope.pdfjsWorker = require('pdfjs-dist/legacy/build/pdf.worker.mjs');
    }
    return lib;
}

interface PdfPage {
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
    cleanup?(): void;
}
interface PdfDocument {
    numPages: number;
    getPage(n: number): Promise<PdfPage>;
    destroy?(): Promise<void>;
}

function joinTextItems(items: PdfTextItem[]): string {
    let out = '';
    for (const item of items) {
        out += item.str ?? '';
        if (item.hasEOL) out += '\n';
    }
    return out;
}

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
    const pdfjs = loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;

    const extract = async (): Promise<string> => {
        const pageTexts: string[] = [];
        for (let start = 1; start <= doc.numPages; start += PDF_PAGE_BATCH_SIZE) {
            const end = Math.min(start + PDF_PAGE_BATCH_SIZE - 1, doc.numPages);
            const nums = Array.from({ length: end - start + 1 }, (_, i) => start + i);
            const texts = await Promise.all(nums.map(async (n) => {
                const page = await doc.getPage(n);
                try {
                    return joinTextItems((await page.getTextContent()).items);
                } finally {
                    page.cleanup?.();
                }
            }));
            pageTexts.push(...texts);
        }
        const text = pageTexts.join('\n\n').trim();
        if (!text) {
            throw new Error('No extractable text found in this PDF. It may be image-based (scanned). Image OCR is not yet supported locally.');
        }
        return text;
    };

    try {
        return await Promise.race([
            extract(),
            new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error(
                    `PDF text extraction timed out after ${PDF_TIMEOUT_MS}ms. The file may be unusually large or complex.`,
                )), PDF_TIMEOUT_MS)),
        ]);
    } finally {
        await doc.destroy?.();
    }
}

// ------------------------------------------------------------------ DOCX (ZIP)

const EOCD_SIGNATURE = 0x06054b50;      // "PK\x05\x06"
const CENTRAL_SIGNATURE = 0x02014b50;   // "PK\x01\x02"
const LOCAL_SIGNATURE = 0x04034b50;     // "PK\x03\x04"

function readZipEntry(
    data: Uint8Array,
    view: DataView,
    localHeaderOffset: number,
    compressionMethod: number,
    compressedSize: number,
    uncompressedSize: number,
): Uint8Array | null {
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_SIGNATURE) return null;
    const nameLen = view.getUint16(localHeaderOffset + 26, true);
    const extraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + nameLen + extraLen;

    if (compressionMethod === 0) return data.slice(dataStart, dataStart + uncompressedSize);
    if (compressionMethod === 8) {
        try {
            const { inflateRawSync } = require('zlib') as typeof import('zlib');
            return new Uint8Array(inflateRawSync(Buffer.from(data.slice(dataStart, dataStart + compressedSize))));
        } catch (e) {
            console.error('[host/extract] DOCX decompression failed:', e);
            return null;
        }
    }
    return null;
}

/** Locates word/document.xml via the ZIP central directory and strips its markup. */
export function extractDocxText(buffer: ArrayBuffer): string {
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);

    let eocd = -1;
    for (let i = data.length - 22; i >= 0 && i >= data.length - 22 - 0xffff; i--) {
        if (view.getUint32(i, true) === EOCD_SIGNATURE) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('DOCX: end-of-central-directory record not found');

    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);

    for (let i = 0; i < entryCount; i++) {
        if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = new TextDecoder().decode(data.slice(offset + 46, offset + 46 + nameLen));

        if (name === 'word/document.xml') {
            const entry = readZipEntry(data, view, localOffset, method, compressedSize, uncompressedSize);
            if (!entry) throw new Error('DOCX: could not read word/document.xml');
            return xmlToText(new TextDecoder().decode(entry));
        }
        offset += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('DOCX: word/document.xml not found');
}

function xmlToText(xml: string): string {
    return xml
        .replace(/<w:p[ >]/g, '\n<w:p ')
        .replace(/<w:tab\b[^>]*\/>/g, '\t')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
