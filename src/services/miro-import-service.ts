/**
 * Miro board import — fetches a single Miro board's items and connectors via Miro's REST API v2
 * and writes them into the vault as a readable Markdown note, so the AI agent (which reads the
 * vault directly off disk, with no in-app semantic index) can use the content as context.
 *
 * This is deliberately NOT built on the existing "enricher" framework (src/services/enrichers/):
 * enrichers are single-query, single-HTTP-call lookup tools invoked by the AI agent mid-chat
 * (one query string in, one response out, hard-truncated to a few thousand chars, no pagination).
 * A Miro board needs cursor-based pagination across two endpoints (items, connectors) and easily
 * exceeds that truncation limit -- the wrong shape entirely.
 */

import { requestUrl, RequestUrlResponse, App, TFile, normalizePath } from 'obsidian';
import { ensureFolderChain } from '../utils/vault-bootstrap-fs';
import { sanitizeFilename } from '../entities/types';

export enum MiroImportErrorType {
    InvalidInput = 'INVALID_INPUT',
    Unauthorized = 'UNAUTHORIZED',
    NotFound = 'NOT_FOUND',
    RateLimited = 'RATE_LIMITED',
    NetworkError = 'NETWORK_ERROR',
    Unknown = 'UNKNOWN',
}

export class MiroImportError extends Error {
    constructor(
        public readonly type: MiroImportErrorType,
        message: string,
    ) {
        super(message);
        this.name = 'MiroImportError';
    }
}

export interface MiroBoardMeta {
    id: string;
    name: string;
    description?: string;
    viewLink?: string;
}

export interface MiroItem {
    id: string;
    type: string;
    parentId?: string;
    content?: string;
    title?: string;
}

export interface MiroConnector {
    id: string;
    startItemId?: string;
    endItemId?: string;
    captionText?: string;
}

export interface MiroBoardSnapshot {
    board: MiroBoardMeta;
    items: MiroItem[];
    connectors: MiroConnector[];
}

interface RawMiroItem {
    id: string;
    type: string;
    parent?: { id: string } | null;
    data?: { content?: string; title?: string } | null;
}

interface RawMiroConnector {
    id: string;
    startItem?: { id: string } | null;
    endItem?: { id: string } | null;
    captions?: { content?: string }[];
}

/**
 * Accepts a raw Miro board ID or a full board URL (e.g. "https://miro.com/app/board/uXjVI.../")
 * and returns the board ID, or null if nothing resembling one was found.
 */
export function parseMiroBoardId(input: string): string | null {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;

    try {
        const url = new URL(trimmed);
        if (/(^|\.)miro\.com$/i.test(url.hostname)) {
            const segments = url.pathname.split('/').filter(Boolean);
            const boardIdx = segments.findIndex((s) => s.toLowerCase() === 'board');
            const candidate = boardIdx >= 0 ? segments[boardIdx + 1] : segments[segments.length - 1];
            return candidate ? decodeURIComponent(candidate) : null;
        }
        return null; // a well-formed non-miro.com URL is not a valid input
    } catch {
        // Not a URL -- fall through to raw-ID handling.
    }

    // Miro board IDs are alphanumeric plus =, _, - (base64url-ish); reject spaces/slashes.
    return /^[A-Za-z0-9_=-]+$/.test(trimmed) ? trimmed : null;
}

/** Strips Miro's HTML-ish item/connector text content down to plain, readable text. */
export function stripMiroHtml(html: string | undefined | null): string {
    if (!html) return '';
    let text = html;
    text = text.replace(/<li[^>]*>/gi, '- ');
    text = text.replace(/<(br|\/p|\/li)[^>]*>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/gi, ' ');
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&lt;/gi, '<');
    text = text.replace(/&gt;/gi, '>');
    text = text.replace(/&quot;/gi, '"');
    text = text.replace(/&#39;/gi, "'");
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

/** Builds the Markdown note content for an imported board snapshot. */
export function buildMiroBoardMarkdown(
    snapshot: MiroBoardSnapshot,
    opts: { sourceUrl: string; importedAtIso: string },
): string {
    const { board, items, connectors } = snapshot;
    const lines: string[] = [];

    // Double-quoted YAML scalars require backslashes, quotes, and control chars (newlines
    // included) to be escaped -- an embedded raw newline (e.g. from a board name someone else
    // set via the API) would otherwise corrupt the whole frontmatter block.
    const yamlEscape = (s: string): string =>
        s
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\r\n|\r|\n/g, '\\n')
            .replace(/\t/g, '\\t');

    lines.push('---');
    lines.push(`miro_board_id: "${yamlEscape(board.id)}"`);
    lines.push(`miro_board_name: "${yamlEscape(board.name || board.id)}"`);
    lines.push(`miro_source_url: "${yamlEscape(opts.sourceUrl)}"`);
    lines.push(`imported_at: "${yamlEscape(opts.importedAtIso)}"`);
    lines.push('osint_copilot_import: miro-board');
    lines.push('---', '');
    lines.push(`# Miro Board: ${board.name || board.id}`, '');
    if (board.description) {
        lines.push(board.description, '');
    }
    lines.push(`Source: ${opts.sourceUrl}`, `Imported: ${opts.importedAtIso}`, '');

    const byId = new Map(items.map((i) => [i.id, i]));
    const itemLabel = (item: MiroItem): string => {
        const text = stripMiroHtml(item.content).replace(/\n+/g, ' ').trim();
        if (text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;
        if (item.title) return item.title;
        return `[${item.type} ${item.id.slice(0, 8)}]`;
    };

    const frames = items.filter((i) => i.type === 'frame');
    const frameIds = new Set(frames.map((f) => f.id));
    for (const frame of frames) {
        lines.push(`## Frame: ${frame.title || itemLabel(frame)}`, '');
        const children = items.filter((i) => i.parentId === frame.id && i.id !== frame.id);
        if (children.length === 0) {
            lines.push('_No items in this frame._');
        } else {
            for (const item of children) lines.push(`- **[${item.type}]** ${itemLabel(item)}`);
        }
        lines.push('');
    }

    const ungrouped = items.filter((i) => i.type !== 'frame' && (!i.parentId || !frameIds.has(i.parentId)));
    if (ungrouped.length > 0) {
        lines.push('## Ungrouped items', '');
        for (const item of ungrouped) lines.push(`- **[${item.type}]** ${itemLabel(item)}`);
        lines.push('');
    }

    if (connectors.length > 0) {
        lines.push('## Connections', '');
        for (const c of connectors) {
            const resolve = (id?: string): string => {
                if (!id) return '[unknown]';
                const item = byId.get(id);
                return item ? itemLabel(item) : `[unknown item ${id.slice(0, 8)}]`;
            };
            const caption = c.captionText ? ` (${stripMiroHtml(c.captionText)})` : '';
            lines.push(`- ${resolve(c.startItemId)} → ${resolve(c.endItemId)}${caption}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

export class MiroImportService {
    private static readonly API_BASE = 'https://api.miro.com';
    private static readonly PAGE_LIMIT = 50; // Miro's documented max per page
    private static readonly MAX_PAGES = 200; // safety cap: up to 10,000 items/connectors per resource

    /** Fetches board metadata plus every item and connector, paginating as needed. */
    async fetchBoardSnapshot(boardIdOrUrl: string, token: string): Promise<MiroBoardSnapshot> {
        const boardId = parseMiroBoardId(boardIdOrUrl);
        if (!boardId) {
            throw new MiroImportError(
                MiroImportErrorType.InvalidInput,
                'Could not find a board ID in that value. Paste a Miro board URL or a raw board ID.',
            );
        }
        const trimmedToken = token.trim();
        if (!trimmedToken) {
            throw new MiroImportError(
                MiroImportErrorType.InvalidInput,
                'Miro access token is not set. Add it in Settings first.',
            );
        }

        // Independent requests -- fetch concurrently rather than summing their latencies.
        const [board, rawItems, rawConnectors] = await Promise.all([
            this.fetchBoardMeta(boardId, trimmedToken),
            this.fetchAllPages<RawMiroItem>(`/v2/boards/${boardId}/items`, trimmedToken),
            this.fetchAllPages<RawMiroConnector>(`/v2/boards/${boardId}/connectors`, trimmedToken),
        ]);

        return {
            board,
            items: rawItems.map((raw) => ({
                id: raw.id,
                type: raw.type,
                parentId: raw.parent?.id,
                content: raw.data?.content,
                title: raw.data?.title,
            })),
            connectors: rawConnectors.map((raw) => ({
                id: raw.id,
                startItemId: raw.startItem?.id,
                endItemId: raw.endItem?.id,
                captionText: raw.captions?.map((c) => c.content).filter(Boolean).join(' / '),
            })),
        };
    }

    /**
     * Writes/overwrites `<boardsFolder>/<sanitized board name> (<board id>).md`. The board ID is
     * always included, not just the name -- two different boards can share a display name (e.g.
     * both called "Investigation"), and the ID is what actually makes a re-import of the SAME
     * board overwrite its own note instead of silently clobbering an unrelated board's note that
     * merely happens to share its name. Re-importing the same board always overwrites -- this is
     * a one-shot on-demand refresh, not a versioned history.
     */
    async importBoardToVault(
        app: App,
        boardsFolder: string,
        snapshot: MiroBoardSnapshot,
        sourceUrl: string,
    ): Promise<{ path: string; overwritten: boolean }> {
        await ensureFolderChain(app, boardsFolder);
        const fileName = `${sanitizeFilename(snapshot.board.name || snapshot.board.id)} (${sanitizeFilename(snapshot.board.id)}).md`;
        const path = normalizePath(`${boardsFolder}/${fileName}`);
        const content = buildMiroBoardMarkdown(snapshot, { sourceUrl, importedAtIso: new Date().toISOString() });

        const existing = app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            await app.vault.modify(existing, content);
            return { path, overwritten: true };
        }
        await app.vault.create(path, content);
        return { path, overwritten: false };
    }

    private async fetchBoardMeta(boardId: string, token: string): Promise<MiroBoardMeta> {
        const response = await requestUrl({
            url: `${MiroImportService.API_BASE}/v2/boards/${boardId}`,
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            throw: false,
        });
        this.assertOkOrThrow(response);
        const body = response.json as { id: string; name?: string; description?: string; viewLink?: string };
        return { id: body.id, name: body.name || boardId, description: body.description, viewLink: body.viewLink };
    }

    private async fetchAllPages<T>(path: string, token: string): Promise<T[]> {
        const results: T[] = [];
        let cursor: string | undefined;
        let page = 0;
        do {
            const params = new URLSearchParams({ limit: String(MiroImportService.PAGE_LIMIT) });
            if (cursor) params.set('cursor', cursor);
            const response: RequestUrlResponse = await requestUrl({
                url: `${MiroImportService.API_BASE}${path}?${params.toString()}`,
                method: 'GET',
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                throw: false,
            });
            this.assertOkOrThrow(response);
            const body = response.json as { data?: T[]; cursor?: string };
            results.push(...(body.data ?? []));
            cursor = body.cursor || undefined;
            page++;
            if (page >= MiroImportService.MAX_PAGES) {
                console.warn(`[MiroImportService] Hit MAX_PAGES (${MiroImportService.MAX_PAGES}) fetching ${path}; results may be incomplete.`);
                break;
            }
        } while (cursor);
        return results;
    }

    private assertOkOrThrow(response: RequestUrlResponse): void {
        if (response.status === 401) {
            throw new MiroImportError(
                MiroImportErrorType.Unauthorized,
                'Miro rejected the access token (401). Check the token in Settings.',
            );
        }
        if (response.status === 404) {
            throw new MiroImportError(
                MiroImportErrorType.NotFound,
                'Board not found, or this token does not have access to it (404).',
            );
        }
        if (response.status === 429) {
            throw new MiroImportError(
                MiroImportErrorType.RateLimited,
                'Miro API rate limit hit (429). Wait a moment and try again.',
            );
        }
        if (response.status < 200 || response.status >= 300) {
            throw new MiroImportError(
                MiroImportErrorType.NetworkError,
                `Miro API request failed with status ${response.status}.`,
            );
        }
    }
}

export const miroImportService = new MiroImportService();
