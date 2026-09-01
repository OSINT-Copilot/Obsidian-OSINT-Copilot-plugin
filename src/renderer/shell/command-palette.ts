/**
 * Command palette and quick switcher.
 *
 * The palette reads the Plugin command registry directly -- the 20 addCommand calls
 * already in vault-ai-plugin are the content, so this is essentially free. The quick
 * switcher reads the Vault index for the same reason.
 */
import type { App } from '../../obsidian-shim/app';
import type { Command, Plugin } from '../../obsidian-shim/core/plugin';
import { TFile } from '../../obsidian-shim/vault/tfile';

interface Entry {
    id: string;
    label: string;
    sublabel?: string;
    run(): unknown;
}

/** Subsequence match with a simple locality score -- good enough, no dependency. */
function fuzzyScore(query: string, text: string): number | null {
    if (!query) return 0;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let score = 0;
    let at = -1;
    for (const char of q) {
        const found = t.indexOf(char, at + 1);
        if (found === -1) return null;
        score += found === at + 1 ? 2 : 1;   // reward contiguous runs
        at = found;
    }
    return score - text.length * 0.01;       // mild preference for shorter matches
}

export class CommandPalette {
    private overlay: HTMLElement | null = null;
    private entries: Entry[] = [];
    private filtered: Entry[] = [];
    private selected = 0;

    constructor(private readonly app: App, private readonly plugin: Plugin) {
        document.addEventListener('keydown', (event) => {
            const mod = event.metaKey || event.ctrlKey;
            if (mod && event.key.toLowerCase() === 'p') {
                event.preventDefault();
                this.openCommands();
            } else if (mod && event.key.toLowerCase() === 'o') {
                event.preventDefault();
                this.openFiles();
            } else if (event.key === 'Escape') {
                this.close();
            }
        });
    }

    openCommands(): void {
        this.open(
            [...this.plugin.commands.values()].map((command: Command) => ({
                id: command.id,
                label: command.name,
                run: () => {
                    if (command.callback) return command.callback();
                    command.checkCallback?.(false);
                },
            })),
            'Run a command…',
        );
    }

    openFiles(): void {
        this.open(
            this.app.vault.getMarkdownFiles().map((file: TFile) => ({
                id: file.path,
                label: file.basename,
                sublabel: file.parent?.path === '/' ? undefined : file.parent?.path,
                run: () => this.app.workspace.getLeaf(false).openFile(file),
            })),
            'Open a note…',
        );
    }

    private open(entries: Entry[], placeholder: string): void {
        this.close();
        this.entries = entries;
        this.filtered = entries.slice(0, 50);
        this.selected = 0;

        this.overlay = document.body.createDiv({ cls: 'palette-overlay' });
        this.overlay.addEventListener('click', (event) => {
            if (event.target === this.overlay) this.close();
        });

        const panel = this.overlay.createDiv({ cls: 'palette' });
        const input = panel.createEl('input', { cls: 'palette-input', placeholder });
        const list = panel.createDiv({ cls: 'palette-list' });

        const renderList = () => {
            list.empty();
            this.filtered.forEach((entry, index) => {
                const row = list.createDiv({ cls: index === this.selected ? 'palette-item is-selected' : 'palette-item' });
                row.createSpan({ cls: 'palette-item-label', text: entry.label });
                if (entry.sublabel) row.createSpan({ cls: 'palette-item-sub', text: entry.sublabel });
                row.addEventListener('click', () => this.runSelected(index));
            });
            if (this.filtered.length === 0) list.createDiv({ cls: 'palette-empty', text: 'No matches' });
        };

        input.addEventListener('input', () => {
            const query = input.value;
            this.filtered = this.entries
                .map((entry) => ({ entry, score: fuzzyScore(query, entry.label) }))
                .filter((row): row is { entry: Entry; score: number } => row.score !== null)
                .sort((a, b) => b.score - a.score)
                .slice(0, 50)
                .map((row) => row.entry);
            this.selected = 0;
            renderList();
        });

        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.selected = Math.min(this.selected + 1, this.filtered.length - 1);
                renderList();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                this.selected = Math.max(this.selected - 1, 0);
                renderList();
            } else if (event.key === 'Enter') {
                event.preventDefault();
                this.runSelected(this.selected);
            }
        });

        renderList();
        input.focus();
    }

    private runSelected(index: number): void {
        const entry = this.filtered[index];
        this.close();
        void entry?.run();
    }

    close(): void {
        this.overlay?.remove();
        this.overlay = null;
    }
}
