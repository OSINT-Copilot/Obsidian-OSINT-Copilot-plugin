/**
 * Left sidebar: Files, Search, Backlinks.
 *
 * These are the three things that made Obsidian necessary alongside the plugin.
 */
import type { App } from '../../obsidian-shim/app';
import { TFile } from '../../obsidian-shim/vault/tfile';
import { setIcon } from '../../obsidian-shim/ui/set-icon';
import { FileExplorer } from './file-explorer';
import { LinkIndex } from './link-index';
import { searchVault, type SearchHit } from './search';

type PaneId = 'files' | 'search' | 'backlinks';

const PANES: { id: PaneId; icon: string; title: string }[] = [
    { id: 'files', icon: 'folder', title: 'Files' },
    { id: 'search', icon: 'search', title: 'Search' },
    { id: 'backlinks', icon: 'link', title: 'Backlinks' },
];

export class Sidebar {
    private active: PaneId = 'files';
    private readonly tabsEl: HTMLElement;
    private readonly bodyEl: HTMLElement;
    private explorer: FileExplorer | null = null;
    private searchQuery = '';
    private searchHits: SearchHit[] = [];

    constructor(
        private readonly app: App,
        private readonly links: LinkIndex,
        private readonly mount: HTMLElement,
    ) {
        this.mount.addClass('sidebar');
        this.tabsEl = this.mount.createDiv({ cls: 'sidebar-tabs' });
        this.bodyEl = this.mount.createDiv({ cls: 'sidebar-body' });

        this.app.workspace.on('active-leaf-change', () => {
            if (this.active === 'backlinks') this.render();
        });
        this.links.onChange(() => {
            if (this.active === 'backlinks') this.render();
        });

        this.render();
    }

    private render(): void {
        this.tabsEl.empty();
        for (const pane of PANES) {
            const tab = this.tabsEl.createDiv({
                cls: pane.id === this.active ? 'sidebar-tab is-active' : 'sidebar-tab',
                attr: { 'aria-label': pane.title },
            });
            setIcon(tab, pane.icon);
            tab.addEventListener('click', () => { this.active = pane.id; this.render(); });
        }

        this.bodyEl.empty();
        if (this.active === 'files') this.renderFiles();
        else if (this.active === 'search') this.renderSearch();
        else this.renderBacklinks();
    }

    private renderFiles(): void {
        // Rebuilt on each activation; the explorer itself subscribes to vault events.
        this.explorer = new FileExplorer(this.app, this.bodyEl.createDiv());
    }

    private renderSearch(): void {
        const wrap = this.bodyEl.createDiv({ cls: 'search-pane' });
        const input = wrap.createEl('input', { cls: 'search-input', placeholder: 'Search vault…', value: this.searchQuery });
        const results = wrap.createDiv({ cls: 'search-results' });

        const draw = () => {
            results.empty();
            if (this.searchQuery.trim().length < 2) {
                results.createDiv({ cls: 'search-hint', text: 'Type at least two characters.' });
                return;
            }
            results.createDiv({
                cls: 'search-count',
                text: `${this.searchHits.length} file${this.searchHits.length === 1 ? '' : 's'}`,
            });
            for (const hit of this.searchHits) {
                const row = results.createDiv({ cls: 'search-hit' });
                row.createDiv({ cls: 'search-hit-title', text: hit.file.basename });
                row.createDiv({ cls: 'search-hit-path', text: hit.file.path });
                row.createDiv({ cls: 'search-hit-snippet', text: hit.snippet });
                row.addEventListener('click', () => void this.app.workspace.getLeaf(false).openFile(hit.file));
            }
        };

        let timer: number | null = null;
        input.addEventListener('input', () => {
            this.searchQuery = input.value;
            if (timer) window.clearTimeout(timer);
            // Debounced: a keystroke-per-scan over a large vault is wasteful even with
            // cachedRead absorbing the I/O.
            timer = window.setTimeout(async () => {
                this.searchHits = await searchVault(this.app, this.searchQuery);
                draw();
            }, 180);
        });

        draw();
        input.focus();
    }

    private renderBacklinks(): void {
        const wrap = this.bodyEl.createDiv({ cls: 'backlinks-pane' });
        const view = this.app.workspace.activeLeaf?.view;
        const file = (view as { file?: TFile } | undefined)?.file;

        if (!file) {
            wrap.createDiv({ cls: 'search-hint', text: 'Open a note to see its backlinks.' });
            return;
        }

        wrap.createDiv({ cls: 'backlinks-title', text: file.basename });

        const backlinks = this.links.getBacklinks(file.path);
        wrap.createDiv({ cls: 'backlinks-section', text: `Linked mentions (${backlinks.length})` });
        for (const path of backlinks) this.linkRow(wrap, path);
        if (backlinks.length === 0) wrap.createDiv({ cls: 'search-hint', text: 'No backlinks.' });

        const forward = this.links.getForwardLinks(file.path);
        wrap.createDiv({ cls: 'backlinks-section', text: `Outgoing links (${forward.length})` });
        for (const path of forward) this.linkRow(wrap, path);

        const unresolved = this.links.getUnresolved(file.path);
        if (unresolved.length) {
            wrap.createDiv({ cls: 'backlinks-section', text: `Unresolved (${unresolved.length})` });
            for (const target of unresolved) wrap.createDiv({ cls: 'backlink-row is-unresolved', text: target });
        }
    }

    private linkRow(into: HTMLElement, path: string): void {
        const row = into.createDiv({ cls: 'backlink-row', text: path });
        row.addEventListener('click', () => {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        });
    }
}
