/**
 * API Service for AI-powered entity extraction.
 *
 * HYBRID ARCHITECTURE:
 * - This service ONLY handles AI graph generation from text (requires API)
 * - All other features (entity CRUD, connections, graph, map) work locally
 * - Uses local API at http://localhost:5000 by default for development
 * - Can be configured to use remote API for production
 *
 * NOTE: Uses Obsidian's requestUrl to bypass CORS restrictions in Electron.
 * The browser's fetch API is blocked by CORS when making requests from
 * the app://obsidian.md origin to external APIs.
 */

import { requestUrl } from 'obsidian';
import { AIOperation, Entity, ProcessTextResponse, getEntityLabel } from '../entities/types';
import {
    ClaudeCodeService,
    type ExtractionLogOptions,
    type LocalCliService,
} from './claude-code-service';
import { host } from '../host';

/** Optional tuning for vault ingest: smaller chunks + per-chunk callback for live UI. */
export interface VaultProcessTextChunkOptions {
    chunkSize?: number;
    chunkThreshold?: number;
    onChunkOperations?: (info: {
        chunkIndex: number;
        totalChunks: number;
        operations: AIOperation[];
    }) => void | Promise<void>;
}

export interface ApiHealthResponse {
    status: string;
    openai_configured: boolean;
    version?: string;
}

/**
 * Callback for retry notifications (reserved for future local retry UX).
 */
export type RetryCallback = (attempt: number, maxAttempts: number, reason: string, nextDelayMs: number) => void;

/** True when failure is normal user/environment (quiet console in ChatView URL flows). */
export function isLikelyExpectedUrlFetchFailure(message: string): boolean {
    return (
        /^HTTP (401|403)\b/.test(message) ||
        /^Failed to fetch URL \(HTTP (401|403|407|429)\)/.test(message) ||
        message.includes('Obsidian cannot fetch this URL')
    );
}

/** Non-throwing URL fetch + text extraction for orchestration (expected failures are ok:false). */
export type UrlExtractResult =
    | { ok: true; text: string }
    | { ok: false; status?: number; shortMessage: string; /** Longer copy for modal/Notice (401/403). */ longDetail?: string };

// Local interface to avoid circular dependency with main.ts
export interface ApiSettings {
    apiProvider: 'claude-code' | 'codex';
    claudeCodeCliPath?: string;
    claudeCodeModel?: string;
}

/**
 * API Service for AI-powered entity extraction.
 *
 * This is the ONLY feature that requires the API:
 * - processText(): Extract entities from natural language text
 *
 * All other graph features work locally without the API:
 * - Manual entity creation/editing/deletion (via EntityManager)
 * - Connection creation (via EntityManager)
 * - Graph visualization (via GraphView)
 * - Map view for locations (via MapView)
 * - Geocoding (via GeocodingService - uses Nominatim, not this API)
 */
export class GraphApiService {
    private isOnline: boolean = false;
    private settings: ApiSettings | null = null;
    private localCliServices = new Map<string, LocalCliService>();

    constructor() {}

    setClaudeCodeService(service: ClaudeCodeService): void {
        this.setLocalCliService(service);
    }

    setLocalCliService(service: LocalCliService): void {
        this.localCliServices.set(service.providerId, service);
    }

    private getLocalCliService(providerId?: string): LocalCliService | null {
        const selected = providerId || this.settings?.apiProvider || 'claude-code';
        return this.localCliServices.get(selected) || null;
    }

    /**
     * Update settings.
     */
    setSettings(settings: ApiSettings): void {
        this.settings = settings;
    }

    /** Check whether the selected (or explicitly requested) local CLI is reachable. */
    async checkHealth(providerId?: string): Promise<ApiHealthResponse | null> {
        const activeProvider = this.settings?.apiProvider || 'claude-code';
        const selectedProvider = providerId || activeProvider;
        const service = this.getLocalCliService(selectedProvider);
        if (service) {
            const available = await service.isAvailable();
            if (selectedProvider === activeProvider) this.isOnline = available;
            return available
                ? { status: 'ok', openai_configured: true, version: `${service.providerId}-local` }
                : null;
        }
        if (selectedProvider === activeProvider) this.isOnline = false;
        return null;
    }

    /**
     * Get the current online status (selected local CLI probe).
     */
    getOnlineStatus(): boolean {
        return this.isOnline;
    }

    /** One-line status for logs and throw messages (orchestration uses tryExtract; UI may show more). */
    private shortHttpFetchMessage(status: number): string {
        if (status === 401 || status === 403) {
            return `HTTP ${status} (page not loaded — sign-in or site protection may be required)`;
        }
        if (status === 429) {
            return `HTTP ${status} (rate limited)`;
        }
        return `HTTP ${status} (page not loaded)`;
    }

    /** Longer guidance for modal / Notice when extractTextFromUrl throws (optional UI). */
    urlFetchDeniedExplanationForUi(status: number, url: string, headers: Record<string, unknown> | undefined): string {
        if (status !== 401 && status !== 403) {
            return `Failed to fetch URL (HTTP ${status})`;
        }
        const hKeys = headers && typeof headers === 'object' ? Object.keys(headers).map((k) => k.toLowerCase()) : [];
        const cloudflare = hKeys.some((k) => k.includes('cf-'));
        const webmail = /_task=mail|roundcube|webmail|\/owa\/|zimbra|horde\//i.test(url);
        const parts = [
            `HTTP ${status}: Obsidian cannot fetch this URL as a logged-in browser would.`,
            'The request is sent without your site cookies, so webmail, private portals, and many authenticated links return 401/403.',
        ];
        if (webmail) {
            parts.push('For email: export or copy the message text into chat instead of pasting the webmail print URL.');
        }
        if (cloudflare) {
            parts.push('Headers suggest Cloudflare in front; automated clients are often blocked until a real browser completes any checks.');
        }
        return parts.join(' ');
    }

    /**
     * Fetch URL and extract text without throwing (for unified orchestration).
     */
    async tryExtractTextFromUrl(url: string): Promise<UrlExtractResult> {
        console.debug('[GraphApiService] tryExtractTextFromUrl:', url);
        try {
            const response = await requestUrl({
                url,
                method: 'GET',
                headers: { 'Accept': 'text/html,application/xhtml+xml,text/plain,*/*' },
                throw: false,
            });

            if (response.status < 200 || response.status >= 300) {
                const hdrs = response.headers as Record<string, unknown> | undefined;
                const longDetail =
                    response.status === 401 || response.status === 403
                        ? this.urlFetchDeniedExplanationForUi(response.status, url, hdrs)
                        : undefined;
                return {
                    ok: false,
                    status: response.status,
                    shortMessage: this.shortHttpFetchMessage(response.status),
                    longDetail,
                };
            }

            const contentType = (response.headers?.['content-type'] || '').toLowerCase();
            let text = response.text || '';

            if (contentType.includes('text/html') || text.trimStart().startsWith('<')) {
                text = this.htmlToText(text);
            }

            const trimmed = text.trim();
            if (!trimmed) {
                return { ok: false, shortMessage: 'No extractable text from this URL' };
            }

            console.debug('[GraphApiService] Extracted text length:', trimmed.length);
            return { ok: true, text: trimmed };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.debug('[GraphApiService] tryExtractTextFromUrl failed:', msg);
            return { ok: false, shortMessage: msg.slice(0, 200) };
        }
    }

    /**
     * Extract text from a URL locally by fetching the page and stripping HTML.
     * Throws on failure (short message); use tryExtractTextFromUrl to avoid throws in orchestration.
     */
    async extractTextFromUrl(url: string): Promise<string> {
        const r = await this.tryExtractTextFromUrl(url);
        if (r.ok) return r.text;

        let host = '';
        try {
            host = new URL(url).hostname;
        } catch {
            host = '';
        }
        console.debug(`[GraphApiService] extractTextFromUrl skipped${host ? ` (${host})` : ''}: ${r.shortMessage}`);

        throw new Error(r.longDetail ?? r.shortMessage);
    }

    private htmlToText(html: string): string {
        let text = html;
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
        text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
        text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
        text = text.replace(/<!--[\s\S]*?-->/g, '');
        text = text.replace(/<(br|hr|p|div|li|tr|h[1-6])[^>]*\/?>/gi, '\n');
        text = text.replace(/<[^>]+>/g, '');
        text = text.replace(/&nbsp;/gi, ' ');
        text = text.replace(/&amp;/gi, '&');
        text = text.replace(/&lt;/gi, '<');
        text = text.replace(/&gt;/gi, '>');
        text = text.replace(/&quot;/gi, '"');
        text = text.replace(/&#39;/gi, "'");
        text = text.replace(/&[a-zA-Z]+;/g, ' ');
        text = text.replace(/[ \t]+/g, ' ');
        text = text.replace(/\n{3,}/g, '\n\n');
        return text.trim();
    }

    private static TEXT_EXTENSIONS = new Set([
        'md', 'txt', 'csv', 'json', 'xml', 'html', 'htm', 'log',
        'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
        'sh', 'bat', 'ps1', 'py', 'js', 'ts', 'jsx', 'tsx',
        'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb',
        'css', 'scss', 'less', 'sql', 'r', 'swift', 'kt',
    ]);

    /**
     * Extract text from a file locally.
     * Text formats are read directly. PDFs use the bundled pdfjs-dist. DOCX uses XML extraction.
     * Other binary formats are saved to temp and processed by the selected local AI CLI.
     */
    async extractTextFromFile(file: File): Promise<string> {
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Limit is 10MB.`);
        }

        const ext = (file.name.split('.').pop() || '').toLowerCase();

        if (GraphApiService.TEXT_EXTENSIONS.has(ext)) {
            return this.readFileAsText(file);
        }

        if (ext === 'pdf') {
            return this.extractPdfText(file);
        }

        if (ext === 'docx') {
            return this.extractDocxText(file);
        }

        throw new Error(
            `Local text extraction for .${ext} files is not yet supported.\n` +
            `Supported: text files, PDF, DOCX.\n` +
            `Tip: paste the text content directly into the chat instead.`
        );
    }

    /**
     * Extract text/information from an image file using the selected CLI's image support.
     */
    async extractTextFromImage(absolutePath: string, signal?: AbortSignal, logOptions?: ExtractionLogOptions): Promise<string> {
        const service = this.getLocalCliService();
        if (!service) {
            throw new Error('Local AI CLI service not initialized.');
        }
        return service.extractTextFromImage(absolutePath, signal, logOptions);
    }

    private readFileAsText(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    /** Pages processed per batch, bounding peak memory/CPU for very long documents. */
    /**
     * PDF and DOCX text extraction run in the Electron main process.
     *
     * pdfjs-dist's legacy build and zlib.inflateRawSync are both Node-only, so under a
     * sandboxed renderer they cannot live here. Moving them also removed
     * globalThis.pdfjsWorker -- a module-level global that used to survive plugin
     * unload -- from the renderer entirely. The implementations are unchanged; see
     * src/host/node/extract.ts.
     */
    private async extractPdfText(file: File): Promise<string> {
        return host.extract.pdfText(await this.readFileAsArrayBuffer(file));
    }

    private async extractDocxText(file: File): Promise<string> {
        return host.extract.docxText(await this.readFileAsArrayBuffer(file));
    }

    /**
     * General-purpose model call via the selected local AI CLI.
     */
    async callRemoteModel(
        messages: { role: string, content: string }[],
        jsonResponse: boolean = false,
        customModel?: string,
        signal?: AbortSignal,
        orchestrationOptions?: { provider: 'osint-copilot' | 'local' | 'remote', url: string, apiKey: string },
        logOptions?: ExtractionLogOptions
    ): Promise<string> {
        return this.callLocalProviderModel(
            this.settings?.apiProvider || 'claude-code',
            messages,
            jsonResponse,
            signal,
            logOptions,
        );
    }

    /** Run a model turn through a specific built-in local CLI, independent of extraction selection. */
    async callLocalProviderModel(
        providerId: 'claude-code' | 'codex',
        messages: { role: string, content: string }[],
        jsonResponse: boolean = false,
        signal?: AbortSignal,
        logOptions?: ExtractionLogOptions,
    ): Promise<string> {
        const service = this.getLocalCliService(providerId);
        if (!service) {
            throw new Error(`${providerId === 'codex' ? 'Codex' : 'Claude Code'} service not initialized.`);
        }
        let systemPrompt = '';
        let userContent = '';
        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
            } else {
                userContent += (userContent ? '\n' : '') + msg.content;
            }
        }
        if (jsonResponse) {
            systemPrompt += '\n\nRespond ONLY with valid JSON. No explanation, no markdown fences.';
        }
        return service.chat(systemPrompt, userContent, signal, logOptions);
    }

    /**
     * Split text into chunks, trying to break at paragraph boundaries.
     */
    private splitTextIntoChunks(text: string, chunkSize: number = 1000): string[] {
        const chunks: string[] = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= chunkSize) {
                chunks.push(remaining);
                break;
            }

            // Try to find a paragraph break near the chunk size
            let breakPoint = remaining.lastIndexOf('\n\n', chunkSize);
            if (breakPoint === -1 || breakPoint < chunkSize * 0.5) {
                // No paragraph break, try single newline
                breakPoint = remaining.lastIndexOf('\n', chunkSize);
            }
            if (breakPoint === -1 || breakPoint < chunkSize * 0.5) {
                // No newline, try sentence break
                breakPoint = remaining.lastIndexOf('. ', chunkSize);
                if (breakPoint > 0) breakPoint += 1; // Include the period
            }
            if (breakPoint === -1 || breakPoint < chunkSize * 0.5) {
                // No good break point, just cut at chunk size
                breakPoint = chunkSize;
            }

            chunks.push(remaining.substring(0, breakPoint).trim());
            remaining = remaining.substring(breakPoint).trim();
        }

        return chunks;
    }

    /**
     * Process large text by chunking and merging entities.
     * For texts larger than CHUNK_THRESHOLD, splits into chunks and processes each.
     */
    async processTextInChunks(
        text: string,
        existingEntities?: Entity[],
        referenceTime?: string,
        onChunkProgress?: (chunkIndex: number, totalChunks: number, message: string) => void,
        onRetry?: RetryCallback,
        signal?: AbortSignal,
        useLocal: boolean = false,
        vaultChunkOptions?: VaultProcessTextChunkOptions
    ): Promise<ProcessTextResponse> {
        const CHUNK_SIZE = vaultChunkOptions?.chunkSize ?? 700; // Default: keep requests under CDN/proxy time limits
        const CHUNK_THRESHOLD = vaultChunkOptions?.chunkThreshold ?? 1200; // Chunk before a single call gets too heavy

        // For small texts, process directly
        if (text.length <= CHUNK_THRESHOLD) {
            const result = await this.processText(text, existingEntities, referenceTime, onRetry, signal, useLocal);
            if (vaultChunkOptions?.onChunkOperations && result.success && result.operations?.length) {
                await vaultChunkOptions.onChunkOperations({
                    chunkIndex: 1,
                    totalChunks: 1,
                    operations: result.operations,
                });
            }
            return result;
        }

        console.debug(`[GraphApiService] Large text detected (${text.length} chars), processing in chunks`);

        const chunks = this.splitTextIntoChunks(text, CHUNK_SIZE);
        console.debug(`[GraphApiService] Split into ${chunks.length} chunks`);

        const allOperations: ProcessTextResponse['operations'] = [];
        const seenEntities = new Set<string>();  // Track entity keys for deduplication
        let accumulatedEntities = existingEntities || [];

        for (let i = 0; i < chunks.length; i++) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            const chunk = chunks[i];
            const chunkNum = i + 1;

            if (onChunkProgress) {
                onChunkProgress(chunkNum, chunks.length, `Processing chunk ${chunkNum}/${chunks.length}...`);
            }

            console.debug(`[GraphApiService] Processing chunk ${chunkNum}/${chunks.length} (${chunk.length} chars)`);

            try {
                const result = await this.processText(chunk, accumulatedEntities, referenceTime, onRetry, signal, useLocal);

                if (!result.success) {
                    console.warn(`[GraphApiService] Chunk ${chunkNum} failed:`, result.error);
                    // Continue with other chunks instead of failing entirely
                    continue;
                }

                if (result.operations) {
                    const chunkAddedOps: AIOperation[] = [];
                    // Deduplicate entities
                    for (const op of result.operations) {
                        if (op.action === 'create' && op.entities) {
                            const dedupedEntities = op.entities.filter(entity => {
                                // Compute label from properties using type's labelField
                                const label = getEntityLabel(entity.type, entity.properties);
                                const key = `${entity.type}::${label.toLowerCase()}`;
                                if (seenEntities.has(key)) {
                                    console.debug(`[GraphApiService] Skipping duplicate entity: ${key}`);
                                    return false;
                                }
                                seenEntities.add(key);
                                return true;
                            });

                            if (dedupedEntities.length > 0) {
                                const mergedOp: AIOperation = {
                                    ...op,
                                    entities: dedupedEntities
                                };
                                allOperations.push(mergedOp);
                                chunkAddedOps.push(mergedOp);

                                // Add to accumulated entities for context in next chunk
                                accumulatedEntities = [
                                    ...accumulatedEntities,
                                    ...dedupedEntities.map(e => ({
                                        id: `temp-${Date.now()}-${Math.random()}`,
                                        type: e.type,
                                        label: getEntityLabel(e.type, e.properties),
                                        properties: e.properties || {}
                                    }))
                                ];
                            }
                        } else if (op.connections) {
                            // Include connection operations
                            allOperations.push(op);
                            chunkAddedOps.push(op);
                        }
                    }
                    if (vaultChunkOptions?.onChunkOperations && chunkAddedOps.length > 0) {
                        await vaultChunkOptions.onChunkOperations({
                            chunkIndex: chunkNum,
                            totalChunks: chunks.length,
                            operations: chunkAddedOps,
                        });
                    }
                }
            } catch (error) {
                if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
                    throw error;
                }
                console.error(`[GraphApiService] Chunk ${chunkNum} error:`, error);
                // Continue with other chunks
            }
        }

        if (allOperations.length === 0) {
            return {
                success: false,
                error: 'Failed to extract entities from any chunks'
            };
        }

        console.debug(`[GraphApiService] Chunking complete. Total operations: ${allOperations.length}`);

        return {
            success: true,
            operations: allOperations
        };
    }

    /**
     * Process natural language text through the AI to extract entities.
     *
     * THIS IS THE ONLY API-DEPENDENT FEATURE.
     *
     * Features:
     * - Automatic retry with exponential backoff and jitter for transient failures
     * - Adaptive timeout that increases after timeout errors
     * - Request timeout to prevent hanging on slow connections
     * - Distinguishes between retryable and permanent errors
     * - Optional callback for retry notifications (user feedback)
     *
     * When the API is unavailable:
     * - This method returns an error
     * - Users can still create entities manually via the Graph View
     * - All other features continue to work locally
     *
     * @param text - Natural language text to process
     * @param existingEntities - Optional list of existing entities for context
     * @param referenceTime - Optional reference time for relative date parsing
     * @param onRetry - Optional callback for retry notifications
     * @returns ProcessTextResponse with extracted entities and relationships
     */
    async processText(
        text: string,
        existingEntities?: Entity[],
        referenceTime?: string,
        onRetry?: RetryCallback,
        signal?: AbortSignal,
        useLocal: boolean = false
    ): Promise<ProcessTextResponse> {
        const service = this.getLocalCliService();
        if (!service) {
            return {
                success: false,
                error: 'Local AI CLI service not initialized. Please check Settings → OSINT Copilot → Local AI CLI.',
            };
        }
        console.debug(`[GraphApiService] Routing to ${service.displayName} for entity extraction`);
        return service.extractEntities(text, existingEntities, undefined, signal);
    }
}

// Alias for backward compatibility with ai-panel.ts
export { GraphApiService as ApiService };
