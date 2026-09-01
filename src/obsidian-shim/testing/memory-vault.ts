/**
 * An in-memory Vault implementing the exact Obsidian semantics that src/ depends on.
 *
 * This is deliberately NOT a "test double" in the loose sense -- it is the real
 * index-tree + event logic with a Map instead of fs underneath. Phase 2's real
 * Vault reuses this tree and swaps the Map for IPC-backed storage, so there is
 * only ever one implementation of vault semantics in the program.
 *
 * Semantics that are load-bearing and must not be "improved":
 *   - createFolder is NON-recursive and throws Error("Folder already exists.")
 *     on EEXIST. vault-bootstrap-fs.ts:3 matches on `.includes("already exists")`.
 *   - create() on an existing path throws Error("File already exists.") -- same reason.
 *   - getAbstractFileByPath never throws and returns null on miss; "" and "/" resolve
 *     to the root folder.
 *   - Vault events fire SYNCHRONOUSLY from the mutating call, before any filesystem
 *     notification would arrive. This is what makes watcher echo-suppression possible.
 */

import { normalizePath } from '../vault/normalize-path';
import { TAbstractFile, TFile, TFolder, makeFile, makeFolder } from '../vault/tfile';

export type VaultEventName = 'create' | 'modify' | 'delete' | 'rename';
type Handler = (file: TAbstractFile, oldPath?: string) => void;

export interface EventRef {
    name: VaultEventName;
    handler: Handler;
}

export class MemoryVault {
    private index = new Map<string, TAbstractFile>();
    private contents = new Map<string, string>();
    private handlers = new Map<VaultEventName, Set<Handler>>();
    private clock = 1;

    readonly root: TFolder;

    /** Counts every read that reached storage -- lets tests assert cachedRead actually caches. */
    reads = 0;

    constructor() {
        this.root = makeFolder('/', null);
        this.index.set('/', this.root);
    }

    // ---------- events ----------

    on(name: VaultEventName, handler: Handler): EventRef {
        if (!this.handlers.has(name)) this.handlers.set(name, new Set());
        this.handlers.get(name)!.add(handler);
        return { name, handler };
    }

    offref(ref: EventRef): void {
        this.handlers.get(ref.name)?.delete(ref.handler);
    }

    private emit(name: VaultEventName, file: TAbstractFile, oldPath?: string): void {
        for (const handler of this.handlers.get(name) ?? []) handler(file, oldPath);
    }

    // ---------- lookup ----------

    getAbstractFileByPath(path: string): TAbstractFile | null {
        return this.index.get(normalizePath(path)) ?? null;
    }

    getFiles(): TFile[] {
        return [...this.index.values()].filter((f): f is TFile => f instanceof TFile);
    }

    getMarkdownFiles(): TFile[] {
        return this.getFiles().filter((f) => f.extension === 'md');
    }

    // ---------- mutation ----------

    /**
     * Obsidian's createFolder DOES create intermediate folders, but still throws
     * when the *target itself* already exists.
     *
     * Both halves are load-bearing and were confirmed empirically, not assumed:
     *  - Recursive: EntityManager.initialize() creates only the 12 legacy flat type
     *    folders, never `OSINTCopilot/ftm`. saveFTMEntityAsNote then calls its own
     *    ensureFolderExists('OSINTCopilot/ftm/Company') -- a single createFolder on a
     *    path whose parent does not exist. Entities demonstrably land under ftm/ in
     *    production, so the intermediate must be created by this call.
     *    (The "isn't recursive" comment on vault-bootstrap-fs.ensureFolderChain is stale;
     *    that helper is harmless belt-and-braces.)
     *  - Throws on EEXIST: documented in obsidian.d.ts ("@throws Error if folder already
     *    exists"), and vault-bootstrap-fs.ts:3 matches on `.includes("already exists")`.
     */
    async createFolder(path: string): Promise<TFolder> {
        const p = normalizePath(path);
        if (this.index.has(p)) throw new Error('Folder already exists.');
        const folder = this.mkdirp(p);
        this.emit('create', folder);
        return folder;
    }

    /** Creates every missing segment of `path` and returns the leaf folder. */
    private mkdirp(path: string): TFolder {
        const existing = this.index.get(path);
        if (existing instanceof TFolder) return existing;
        if (existing) throw new Error(`Not a folder: ${path}`);

        const slash = path.lastIndexOf('/');
        const parentPath = slash <= 0 ? '/' : path.slice(0, slash);
        const parent = parentPath === '/' ? this.root : this.mkdirp(parentPath);

        const folder = makeFolder(path, parent);
        this.index.set(path, folder);
        parent.children.push(folder);
        return folder;
    }

    async create(path: string, data: string): Promise<TFile> {
        const p = normalizePath(path);
        if (this.index.has(p)) throw new Error('File already exists.');
        const parent = this.requireParent(p);
        const file = makeFile(p, parent, { ctime: this.clock, mtime: this.clock++, size: data.length });
        this.index.set(p, file);
        this.contents.set(p, data);
        parent.children.push(file);
        this.emit('create', file);
        return file;
    }

    async read(file: TFile): Promise<string> {
        this.reads++;
        const data = this.contents.get(file.path);
        if (data === undefined) throw new Error(`File not found: ${file.path}`);
        return data;
    }

    /** Obsidian's cachedRead is read-through cached; callers use it in read-every-file loops. */
    async cachedRead(file: TFile): Promise<string> {
        const data = this.contents.get(file.path);
        if (data === undefined) throw new Error(`File not found: ${file.path}`);
        return data;
    }

    async modify(file: TFile, data: string): Promise<void> {
        if (!this.index.has(file.path)) throw new Error(`File not found: ${file.path}`);
        this.contents.set(file.path, data);
        file.stat = { ...file.stat, mtime: this.clock++, size: data.length };
        this.emit('modify', file);
    }

    async delete(file: TAbstractFile): Promise<void> {
        this.removeFromTree(file);
        this.emit('delete', file);
    }

    async trash(file: TAbstractFile): Promise<void> {
        return this.delete(file);
    }

    // ---------- helpers ----------

    private requireParent(path: string): TFolder {
        const slash = path.lastIndexOf('/');
        const parentPath = slash <= 0 ? '/' : path.slice(0, slash);
        const parent = this.index.get(parentPath);
        if (!parent) throw new Error(`ENOENT: no such folder: ${parentPath}`);
        if (!(parent instanceof TFolder)) throw new Error(`Not a folder: ${parentPath}`);
        return parent;
    }

    private removeFromTree(file: TAbstractFile): void {
        if (file instanceof TFolder) {
            for (const child of [...file.children]) this.removeFromTree(child);
        }
        this.index.delete(file.path);
        this.contents.delete(file.path);
        const siblings = file.parent?.children;
        if (siblings) {
            const at = siblings.indexOf(file);
            if (at >= 0) siblings.splice(at, 1);
        }
    }

    /** Every path currently in the vault, sorted -- the primitive the golden snapshot builds on. */
    snapshotPaths(): string[] {
        return [...this.index.keys()].filter((p) => p !== '/').sort();
    }

    getContent(path: string): string | undefined {
        return this.contents.get(normalizePath(path));
    }
}
