/**
 * Vault link index: forward links and backlinks.
 *
 * This is the piece Obsidian supplied for free, and it is deliberately owned by the
 * shell rather than hidden behind the MetadataCache shim -- there was exactly one
 * getFileCache call site in the whole app, so putting a link graph behind that
 * surface would mean two link models that can disagree.
 *
 * It is also what makes the "stop re-parsing wikilinks into Connections" fix safe:
 * the `## Relationships` sections stay rendered and navigable here without being
 * parsed back into the entity model.
 *
 * Maintained incrementally from vault events, which fire synchronously for our own
 * writes and from the watcher for out-of-band edits.
 */
import type { App } from '../../obsidian-shim/app';
import { TFile } from '../../obsidian-shim/vault/tfile';
import { parseMetadata } from '../../obsidian-shim/core/metadata-cache';

export class LinkIndex {
    /** source path -> resolved target paths */
    private forward = new Map<string, Set<string>>();
    /** target path -> source paths */
    private backward = new Map<string, Set<string>>();
    /** Links whose target does not exist, kept so they can resolve when it appears. */
    private unresolved = new Map<string, Set<string>>();

    private readonly listeners = new Set<() => void>();

    constructor(private readonly app: App) {}

    async build(): Promise<void> {
        this.forward.clear();
        this.backward.clear();
        this.unresolved.clear();

        for (const file of this.app.vault.getMarkdownFiles()) {
            await this.indexFile(file, { silent: true });
        }

        this.app.vault.on('modify', (file) => { if (file instanceof TFile) void this.indexFile(file); });
        this.app.vault.on('create', (file) => { if (file instanceof TFile) void this.indexFile(file); });
        this.app.vault.on('delete', (file) => { this.removeFile(file.path); this.notify(); });
        this.app.vault.on('rename', (file, oldPath) => {
            this.removeFile(oldPath);
            if (file instanceof TFile) void this.indexFile(file);
        });

        this.notify();
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getBacklinks(path: string): string[] {
        return [...(this.backward.get(path) ?? [])].sort();
    }

    getForwardLinks(path: string): string[] {
        return [...(this.forward.get(path) ?? [])].sort();
    }

    getUnresolved(path: string): string[] {
        return [...(this.unresolved.get(path) ?? [])].sort();
    }

    /**
     * Resolves a wikilink target the way Obsidian does: an exact path first, then
     * `<target>.md`, then the shortest-path match on basename. The last rule is why
     * `[[Lukoil]]` finds `OSINTCopilot/ftm/Company/Lukoil.md`.
     */
    resolve(target: string): TFile | null {
        const vault = this.app.vault;
        const direct = vault.getAbstractFileByPath(target);
        if (direct instanceof TFile) return direct;

        const withExt = vault.getAbstractFileByPath(target.endsWith('.md') ? target : `${target}.md`);
        if (withExt instanceof TFile) return withExt;

        const basename = target.split('/').pop() ?? target;
        const matches = vault.getMarkdownFiles().filter((f) => f.basename === basename);
        if (matches.length === 0) return null;
        return matches.sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
    }

    private async indexFile(file: TFile, options: { silent?: boolean } = {}): Promise<void> {
        this.removeFile(file.path);

        const content = await this.app.vault.cachedRead(file);
        const links = parseMetadata(content).links ?? [];

        const resolved = new Set<string>();
        const missing = new Set<string>();
        for (const { link } of links) {
            const target = this.resolve(link);
            if (target) {
                resolved.add(target.path);
                if (!this.backward.has(target.path)) this.backward.set(target.path, new Set());
                this.backward.get(target.path)!.add(file.path);
            } else {
                missing.add(link);
            }
        }

        if (resolved.size) this.forward.set(file.path, resolved);
        if (missing.size) this.unresolved.set(file.path, missing);
        if (!options.silent) this.notify();
    }

    private removeFile(path: string): void {
        for (const target of this.forward.get(path) ?? []) {
            const sources = this.backward.get(target);
            sources?.delete(path);
            if (sources && sources.size === 0) this.backward.delete(target);
        }
        this.forward.delete(path);
        this.unresolved.delete(path);
        this.backward.delete(path);
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }
}
