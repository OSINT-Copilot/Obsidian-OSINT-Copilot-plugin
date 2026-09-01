import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl, TFile } from 'obsidian';
import {
    parseMiroBoardId,
    stripMiroHtml,
    buildMiroBoardMarkdown,
    MiroImportService,
    MiroImportErrorType,
    type MiroBoardSnapshot,
} from '../src/services/miro-import-service';

describe('parseMiroBoardId', () => {
    it('returns a raw board ID unchanged', () => {
        expect(parseMiroBoardId('uXjVI_abc123=')).toBe('uXjVI_abc123=');
    });

    it('extracts the board ID from a full board URL', () => {
        expect(parseMiroBoardId('https://miro.com/app/board/uXjVI_abc123=/')).toBe('uXjVI_abc123=');
    });

    it('extracts the board ID from a board URL without a trailing slash', () => {
        expect(parseMiroBoardId('https://miro.com/app/board/uXjVI_abc123=')).toBe('uXjVI_abc123=');
    });

    it('returns null for a non-miro.com URL', () => {
        expect(parseMiroBoardId('https://example.com/app/board/abc123/')).toBeNull();
    });

    it('returns null for empty or whitespace input', () => {
        expect(parseMiroBoardId('')).toBeNull();
        expect(parseMiroBoardId('   ')).toBeNull();
    });

    it('returns null for input containing spaces or slashes that is not a URL', () => {
        expect(parseMiroBoardId('not a valid id / with slash')).toBeNull();
    });
});

describe('stripMiroHtml', () => {
    it('converts paragraphs and list items into readable text', () => {
        expect(stripMiroHtml('<p>Hello</p><p>World</p>')).toBe('Hello\nWorld');
        expect(stripMiroHtml('<ul><li>One</li><li>Two</li></ul>')).toBe('- One\n- Two');
    });

    it('decodes common HTML entities', () => {
        expect(stripMiroHtml('Tom &amp; Jerry &nbsp;&lt;tag&gt; &quot;quoted&quot; &#39;s&#39;')).toBe(
            `Tom & Jerry <tag> "quoted" 's'`,
        );
    });

    it('returns an empty string for undefined, null, or empty input', () => {
        expect(stripMiroHtml(undefined)).toBe('');
        expect(stripMiroHtml(null)).toBe('');
        expect(stripMiroHtml('')).toBe('');
    });
});

describe('buildMiroBoardMarkdown', () => {
    function snapshot(overrides: Partial<MiroBoardSnapshot> = {}): MiroBoardSnapshot {
        return {
            board: { id: 'board1', name: 'Investigation Board' },
            items: [],
            connectors: [],
            ...overrides,
        };
    }

    it('includes frontmatter with board id, name, source, and imported date', () => {
        const md = buildMiroBoardMarkdown(snapshot(), {
            sourceUrl: 'https://miro.com/app/board/board1/',
            importedAtIso: '2026-09-01T00:00:00.000Z',
        });
        expect(md).toContain('miro_board_id: "board1"');
        expect(md).toContain('miro_board_name: "Investigation Board"');
        expect(md).toContain('miro_source_url: "https://miro.com/app/board/board1/"');
        expect(md).toContain('imported_at: "2026-09-01T00:00:00.000Z"');
    });

    it('escapes quotes and backslashes in every frontmatter field, not just the board name', () => {
        const md = buildMiroBoardMarkdown(
            snapshot({ board: { id: 'board1', name: 'A "Codename" Board' } }),
            { sourceUrl: 'https://miro.com/app/board/abc"123/', importedAtIso: '2026-09-01T00:00:00.000Z' },
        );

        // A raw, unescaped quote inside a quoted YAML scalar would corrupt the frontmatter block.
        expect(md).toContain('miro_board_name: "A \\"Codename\\" Board"');
        expect(md).toContain('miro_source_url: "https://miro.com/app/board/abc\\"123/"');
    });

    it('escapes embedded newlines in frontmatter fields instead of breaking the block with a raw line break', () => {
        const md = buildMiroBoardMarkdown(
            snapshot({ board: { id: 'board1', name: 'Line1\nLine2' } }),
            { sourceUrl: 'https://miro.com/x', importedAtIso: '2026-09-01T00:00:00.000Z' },
        );

        expect(md).toContain('miro_board_name: "Line1\\nLine2"');
        // A failed escape would leave a raw newline, splitting "Line2\"" onto its own line --
        // which is not valid YAML (an unquoted, un-keyed scalar line inside the frontmatter block).
        const lines = md.split('\n');
        expect(lines).not.toContain('Line2"');
    });

    it('groups items under their parent frame heading, and ungrouped items separately', () => {
        const md = buildMiroBoardMarkdown(
            snapshot({
                items: [
                    { id: 'frame1', type: 'frame', title: 'Suspects' },
                    { id: 'note1', type: 'sticky_note', parentId: 'frame1', content: '<p>John Doe</p>' },
                    { id: 'note2', type: 'sticky_note', content: '<p>Loose note</p>' },
                ],
            }),
            { sourceUrl: 'https://miro.com/x', importedAtIso: '2026-09-01T00:00:00.000Z' },
        );

        expect(md).toContain('## Frame: Suspects');
        expect(md).toContain('John Doe');
        expect(md).toContain('## Ungrouped items');
        expect(md).toContain('Loose note');
        // "John Doe" (under the frame) should appear before "Ungrouped items"
        expect(md.indexOf('John Doe')).toBeLessThan(md.indexOf('## Ungrouped items'));
    });

    it('renders connectors resolving to item text, with a fallback for a dangling reference', () => {
        const md = buildMiroBoardMarkdown(
            snapshot({
                items: [
                    { id: 'a', type: 'sticky_note', content: '<p>Alice</p>' },
                    { id: 'b', type: 'sticky_note', content: '<p>Bob</p>' },
                ],
                connectors: [
                    { id: 'c1', startItemId: 'a', endItemId: 'b', captionText: '<p>knows</p>' },
                    { id: 'c2', startItemId: 'a', endItemId: 'missing' },
                ],
            }),
            { sourceUrl: 'https://miro.com/x', importedAtIso: '2026-09-01T00:00:00.000Z' },
        );

        expect(md).toContain('## Connections');
        expect(md).toContain('Alice → Bob (knows)');
        expect(md).toMatch(/Alice → \[unknown item /);
    });
});

describe('MiroImportService.fetchBoardSnapshot', () => {
    let service: MiroImportService;

    beforeEach(() => {
        service = new MiroImportService();
        vi.mocked(requestUrl).mockReset();
    });

    it('rejects an unparseable board input as InvalidInput without making a network call', async () => {
        await expect(service.fetchBoardSnapshot('not a valid / id', 'token')).rejects.toMatchObject({
            type: MiroImportErrorType.InvalidInput,
        });
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it('rejects an empty token as InvalidInput without making a network call', async () => {
        await expect(service.fetchBoardSnapshot('board1', '   ')).rejects.toMatchObject({
            type: MiroImportErrorType.InvalidInput,
        });
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it('fetches board metadata plus all paginated items and connectors', async () => {
        vi.mocked(requestUrl).mockImplementation((async (opts: any) => {
            const url: string = opts.url;
            if (url.endsWith('/v2/boards/board1')) {
                return { status: 200, json: { id: 'board1', name: 'My Board' } };
            }
            if (url.includes('/items')) {
                if (url.includes('cursor=page2')) {
                    return {
                        status: 200,
                        json: { data: [{ id: 'item2', type: 'sticky_note', data: { content: 'Second' } }] },
                    };
                }
                return {
                    status: 200,
                    json: {
                        data: [{ id: 'item1', type: 'sticky_note', data: { content: 'First' } }],
                        cursor: 'page2',
                    },
                };
            }
            if (url.includes('/connectors')) {
                return {
                    status: 200,
                    json: { data: [{ id: 'conn1', startItem: { id: 'item1' }, endItem: { id: 'item2' } }] },
                };
            }
            throw new Error(`Unexpected URL in test: ${url}`);
        }) as any);

        const snapshot = await service.fetchBoardSnapshot('board1', 'my-token');

        expect(snapshot.board).toEqual({ id: 'board1', name: 'My Board', description: undefined, viewLink: undefined });
        expect(snapshot.items.map((i) => i.id)).toEqual(['item1', 'item2']);
        expect(snapshot.connectors).toEqual([{ id: 'conn1', startItemId: 'item1', endItemId: 'item2', captionText: undefined }]);

        // The second items page request must carry the first page's cursor.
        const calls = vi.mocked(requestUrl).mock.calls as any[];
        const itemsCalls = calls.filter(([opts]) => opts.url.includes('/items'));
        expect(itemsCalls[1][0].url).toContain('cursor=page2');
    });

    it('maps 401/404/429 to the corresponding MiroImportErrorType', async () => {
        vi.mocked(requestUrl).mockResolvedValue({ status: 401, json: {} } as any);
        await expect(service.fetchBoardSnapshot('board1', 'bad-token')).rejects.toMatchObject({
            type: MiroImportErrorType.Unauthorized,
        });

        vi.mocked(requestUrl).mockResolvedValue({ status: 404, json: {} } as any);
        await expect(service.fetchBoardSnapshot('board1', 'token')).rejects.toMatchObject({
            type: MiroImportErrorType.NotFound,
        });

        vi.mocked(requestUrl).mockResolvedValue({ status: 429, json: {} } as any);
        await expect(service.fetchBoardSnapshot('board1', 'token')).rejects.toMatchObject({
            type: MiroImportErrorType.RateLimited,
        });
    });

    it('stops paginating once MAX_PAGES is reached, instead of looping forever', async () => {
        vi.mocked(requestUrl).mockImplementation((async (opts: any) => {
            const url: string = opts.url;
            if (url.endsWith('/v2/boards/board1')) {
                return { status: 200, json: { id: 'board1', name: 'Big Board' } };
            }
            // Every page (items or connectors) always returns a cursor -- an unbounded loop
            // without a safety cap would never terminate.
            return { status: 200, json: { data: [{ id: 'x', type: 'sticky_note' }], cursor: 'more' } };
        }) as any);

        await expect(service.fetchBoardSnapshot('board1', 'token')).resolves.toBeDefined();
    });
});

describe('MiroImportService.importBoardToVault', () => {
    // getAbstractFileByPath must be path-aware (not a blanket return value): importBoardToVault
    // calls ensureFolderChain first, which probes each intermediate folder segment
    // ("OSINTCopilot", then "OSINTCopilot/MiroBoards") before the final file-path check -- a
    // blanket mock would make every one of those segments look like it's already a file.
    function makeApp(options: { existingAtPath?: Record<string, TFile> }) {
        return {
            vault: {
                getAbstractFileByPath: vi.fn((path: string) => options.existingAtPath?.[path] ?? null),
                createFolder: vi.fn(() => Promise.resolve()),
                create: vi.fn(() => Promise.resolve()),
                modify: vi.fn(() => Promise.resolve()),
                adapter: { stat: undefined },
            },
        } as any;
    }

    function snapshot(): MiroBoardSnapshot {
        return { board: { id: 'board1', name: 'Investigation Board' }, items: [], connectors: [] };
    }

    it('creates a new note when none exists at the target path', async () => {
        const app = makeApp({});
        const service = new MiroImportService();

        const result = await service.importBoardToVault(app, 'OSINTCopilot/MiroBoards', snapshot(), 'https://miro.com/x');

        expect(result.overwritten).toBe(false);
        expect(app.vault.create).toHaveBeenCalledOnce();
        expect(app.vault.modify).not.toHaveBeenCalled();
        // The board ID is always part of the filename (not just the name), so two different
        // boards that happen to share a display name never collide -- see importBoardToVault.
        expect(result.path).toBe('OSINTCopilot/MiroBoards/Investigation Board (board1).md');
    });

    it('overwrites the existing note when one is already at the target path', async () => {
        const existing = new TFile();
        const app = makeApp({ existingAtPath: { 'OSINTCopilot/MiroBoards/Investigation Board (board1).md': existing } });
        const service = new MiroImportService();

        const result = await service.importBoardToVault(app, 'OSINTCopilot/MiroBoards', snapshot(), 'https://miro.com/x');

        expect(result.overwritten).toBe(true);
        expect(app.vault.modify).toHaveBeenCalledOnce();
        expect(app.vault.create).not.toHaveBeenCalled();
    });

    it('does not collide two different boards that share the same display name', async () => {
        const app = makeApp({});
        const service = new MiroImportService();

        const resultA = await service.importBoardToVault(
            app, 'OSINTCopilot/MiroBoards',
            { board: { id: 'aaa111', name: 'Investigation' }, items: [], connectors: [] },
            'https://miro.com/a',
        );
        const resultB = await service.importBoardToVault(
            app, 'OSINTCopilot/MiroBoards',
            { board: { id: 'bbb222', name: 'Investigation' }, items: [], connectors: [] },
            'https://miro.com/b',
        );

        expect(resultA.path).not.toBe(resultB.path);
    });
});
