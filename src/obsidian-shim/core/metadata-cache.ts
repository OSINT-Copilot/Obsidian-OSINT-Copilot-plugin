/**
 * MetadataCache -- deliberately minimal.
 *
 * There is exactly ONE call site in the entire codebase (vault-ai-plugin.ts:1307,
 * getFileCache), consuming only frontmatter, tags and links. The app parses its own
 * frontmatter with `yaml` everywhere else and has zero dependency on Obsidian's link
 * graph, so reimplementing that graph here would be weeks of work for nothing.
 *
 * Backlinks and link resolution belong to the shell (Phase 5), which owns them for
 * the whole app rather than hiding them behind a compatibility surface.
 */
import { parse as parseYaml } from 'yaml';
import type { TFile } from '../vault/tfile';
import type { Vault } from '../vault/vault';

export interface CachedMetadata {
    frontmatter?: Record<string, unknown>;
    tags?: { tag: string }[];
    links?: { link: string }[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const TAG = /(^|\s)#([\w/-]+)/g;
const WIKILINK = /\[\[([^\]]+)\]\]/g;

export function parseMetadata(content: string): CachedMetadata {
    const cache: CachedMetadata = {};

    const fm = content.match(FRONTMATTER);
    if (fm) {
        try {
            const parsed = parseYaml(fm[1]);
            if (parsed && typeof parsed === 'object') cache.frontmatter = parsed as Record<string, unknown>;
        } catch {
            // Malformed frontmatter is common in a hand-edited vault; treat it as absent
            // rather than failing the whole index build.
        }
    }

    const body = fm ? content.slice(fm[0].length) : content;

    const tags: { tag: string }[] = [];
    for (const match of body.matchAll(TAG)) tags.push({ tag: `#${match[2]}` });
    if (tags.length) cache.tags = tags;

    const links: { link: string }[] = [];
    for (const match of body.matchAll(WIKILINK)) {
        // Strip the display half of [[path|Label]] and any #heading anchor.
        links.push({ link: match[1].split('|')[0].split('#')[0].trim() });
    }
    if (links.length) cache.links = links;

    return cache;
}

export class MetadataCache {
    private cache = new Map<string, { key: string; data: CachedMetadata }>();

    constructor(private readonly vault: Vault) {}

    /**
     * Synchronous, like Obsidian's. Returns null until the file has been read once;
     * the single caller (indexFile) reads the file itself immediately before calling.
     */
    getFileCache(file: TFile): CachedMetadata | null {
        return this.cache.get(file.path)?.data ?? null;
    }

    /** Called by the indexer with content it has already read, so this costs no I/O. */
    setFileCache(file: TFile, content: string): CachedMetadata {
        const data = parseMetadata(content);
        this.cache.set(file.path, { key: `${file.stat.mtime}:${file.stat.size}`, data });
        return data;
    }

    async getOrLoad(file: TFile): Promise<CachedMetadata> {
        const key = `${file.stat.mtime}:${file.stat.size}`;
        const hit = this.cache.get(file.path);
        if (hit && hit.key === key) return hit.data;
        return this.setFileCache(file, await this.vault.cachedRead(file));
    }

    invalidate(path: string): void {
        this.cache.delete(path);
    }
}
