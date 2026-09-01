/**
 * Vault filesystem -- Node side.
 *
 * Every path is confined to the open vault root: the renderer is untrusted, and
 * entity.properties.filePath is LLM-writable, so confinement cannot be enforced on
 * that side. Paths are NFC-normalised on the way out because macOS APFS returns NFD
 * from readdir; an NFD path would miss the renderer's composed index key and send
 * entity-manager down its `create` branch for a file that already exists.
 */
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as nodePath from 'path';
import type { StatDto, WatchEvent } from '../types';

let root: string | null = null;
let watcher: { close(): Promise<void> } | null = null;
const listeners = new Set<(events: WatchEvent[]) => void>();

/**
 * Suppresses the watcher echo of our own writes. Keyed on path+mtime+size, with a
 * short TTL: without this, vault.modify -> chokidar change -> shim 'modify' event ->
 * four registries invalidate -> schema-catalog rebuild, and anything that rebuild
 * writes closes the loop.
 */
const selfWrites = new Map<string, number>();
const SELF_WRITE_TTL_MS = 2000;

function markSelfWrite(stat: StatDto): void {
    selfWrites.set(`${stat.path}:${stat.mtime}:${stat.size}`, Date.now());
}

function isSelfWrite(path: string, mtime: number, size: number): boolean {
    const key = `${path}:${mtime}:${size}`;
    const at = selfWrites.get(key);
    if (at === undefined) return false;
    selfWrites.delete(key);
    return Date.now() - at < SELF_WRITE_TTL_MS;
}

function requireRoot(): string {
    if (!root) throw new Error('No vault is open');
    return root;
}

/** Resolves a vault-relative path to absolute, refusing anything that escapes the root. */
function resolve(vaultPath: string): string {
    const base = requireRoot();
    const normalized = vaultPath === '/' ? '' : vaultPath.replace(/^\/+/, '');
    const absolute = nodePath.resolve(base, normalized);
    const rel = nodePath.relative(base, absolute);
    if (rel.startsWith('..') || nodePath.isAbsolute(rel)) {
        throw new Error(`Path escapes the vault root: ${vaultPath}`);
    }
    return absolute;
}

function toVaultPath(absolute: string): string {
    const rel = nodePath.relative(requireRoot(), absolute).split(nodePath.sep).join('/');
    return (rel === '' ? '/' : rel).normalize('NFC');
}

function toStat(absolute: string, stats: fs.Stats): StatDto {
    return {
        path: toVaultPath(absolute),
        type: stats.isDirectory() ? 'folder' : 'file',
        ctime: stats.birthtimeMs || stats.ctimeMs,
        mtime: stats.mtimeMs,
        size: stats.size,
    };
}

async function walk(dir: string, out: StatDto[]): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const absolute = nodePath.join(dir, entry.name);
        // .git and node_modules would balloon the index for no benefit; Obsidian's own
        // config folder is likewise not part of the OSINT data model.
        if (entry.isDirectory() && (entry.name === '.git' || entry.name === 'node_modules')) continue;
        try {
            out.push(toStat(absolute, await fsp.stat(absolute)));
        } catch {
            continue; // broken symlink, permission denied -- skip rather than abort the scan
        }
        if (entry.isDirectory()) await walk(absolute, out);
    }
}

export async function open(dir: string): Promise<StatDto[]> {
    await watcher?.close();
    watcher = null;
    root = nodePath.resolve(dir);
    await fsp.mkdir(root, { recursive: true });

    const snapshot: StatDto[] = [];
    await walk(root, snapshot);
    await startWatching();
    return snapshot;
}

async function startWatching(): Promise<void> {
    const chokidar = await import('chokidar');
    const base = requireRoot();

    let batch: WatchEvent[] = [];
    let timer: NodeJS.Timeout | null = null;
    const flush = () => {
        timer = null;
        if (batch.length === 0) return;
        const events = batch;
        batch = [];
        for (const listener of listeners) listener(events);
    };
    const push = (event: WatchEvent) => {
        batch.push(event);
        if (!timer) timer = setTimeout(flush, 50);
    };

    const instance = chokidar.watch(base, {
        ignoreInitial: true,
        ignored: (p: string) => p.includes(`${nodePath.sep}.git${nodePath.sep}`) || p.endsWith(`${nodePath.sep}.git`),
        // Editors write in stages; without this we index a half-written note.
        awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
    });

    const onFsEvent = (kind: 'create' | 'modify' | 'delete') => async (absolute: string) => {
        try {
            if (kind === 'delete') {
                push({ kind, path: toVaultPath(absolute) });
                return;
            }
            const stats = await fsp.stat(absolute);
            const stat = toStat(absolute, stats);
            if (isSelfWrite(stat.path, stat.mtime, stat.size)) return;
            push({ kind, path: stat.path, stat });
        } catch { /* raced with a delete */ }
    };

    instance
        .on('add', onFsEvent('create'))
        .on('change', onFsEvent('modify'))
        .on('unlink', onFsEvent('delete'))
        .on('addDir', onFsEvent('create'))
        .on('unlinkDir', onFsEvent('delete'));

    watcher = instance;
}

export function basePath(): string {
    return root ?? '';
}

export function onChange(callback: (events: WatchEvent[]) => void): () => void {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export async function read(path: string): Promise<string> {
    return fsp.readFile(resolve(path), 'utf-8');
}

export async function readBinary(path: string): Promise<Uint8Array> {
    return new Uint8Array(await fsp.readFile(resolve(path)));
}

async function statOf(absolute: string): Promise<StatDto> {
    return toStat(absolute, await fsp.stat(absolute));
}

export async function write(path: string, data: string): Promise<StatDto> {
    const absolute = resolve(path);
    await fsp.mkdir(nodePath.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, data, 'utf-8');
    const stat = await statOf(absolute);
    markSelfWrite(stat);
    return stat;
}

export async function writeBinary(path: string, data: Uint8Array): Promise<StatDto> {
    const absolute = resolve(path);
    await fsp.mkdir(nodePath.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, data);
    const stat = await statOf(absolute);
    markSelfWrite(stat);
    return stat;
}

export async function create(path: string, data: string): Promise<StatDto> {
    const absolute = resolve(path);
    if (fs.existsSync(absolute)) throw new Error('File already exists.');
    await fsp.mkdir(nodePath.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, data, 'utf-8');
    const stat = await statOf(absolute);
    markSelfWrite(stat);
    return stat;
}

export async function mkdir(path: string): Promise<StatDto> {
    const absolute = resolve(path);
    if (fs.existsSync(absolute)) throw new Error('Folder already exists.');
    await fsp.mkdir(absolute, { recursive: true });
    return statOf(absolute);
}

export async function remove(path: string): Promise<void> {
    await fsp.rm(resolve(path), { recursive: true, force: true });
}

export async function rename(from: string, to: string): Promise<void> {
    const target = resolve(to);
    await fsp.mkdir(nodePath.dirname(target), { recursive: true });
    await fsp.rename(resolve(from), target);
}

export async function stat(path: string): Promise<StatDto | null> {
    try {
        return await statOf(resolve(path));
    } catch {
        return null;
    }
}

/** Absolute path, for the trash implementation in main (needs Electron's shell). */
export function absolutePathOf(path: string): string {
    return resolve(path);
}
