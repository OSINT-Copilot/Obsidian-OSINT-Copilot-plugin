/**
 * MarkdownView.
 *
 * Phase 3 ships a functional read/preview view so the workspace is complete and the
 * 8 `getLeaf().openFile(file)` call sites work; Phase 5 replaces the source mode with
 * a real CodeMirror 6 editor.
 *
 * The surface used by the plugin is narrow: `.file`, and getViewState/setViewState
 * with `state.mode` -- vault-ai-plugin.ts:1130-1145 flips locked notes to preview so
 * a locked entity note cannot be edited in place.
 */
import { ItemView } from './view';
import type { WorkspaceLeaf } from './layout';
import { TFile } from '../vault/tfile';
import { MarkdownRenderer } from '../ui/markdown-renderer';
import type { Vault } from '../vault/vault';

export type MarkdownViewMode = 'source' | 'preview';

export const MARKDOWN_VIEW_TYPE = 'markdown';

export class MarkdownView extends ItemView {
    file: TFile | null = null;
    private mode: MarkdownViewMode = 'source';
    private editorEl: HTMLTextAreaElement | null = null;
    private previewEl: HTMLElement | null = null;
    private saveTimer: number | null = null;

    /** Injected by the app so the view can read and write without an App reference. */
    static vaultProvider: (() => Vault | null) | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.containerEl.addClass('markdown-view');
    }

    getViewType(): string {
        return MARKDOWN_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename ?? 'Untitled';
    }

    getIcon(): string {
        return 'file-text';
    }

    getMode(): MarkdownViewMode {
        return this.mode;
    }

    getState(): Record<string, unknown> {
        return { file: this.file?.path ?? null, mode: this.mode };
    }

    async setState(state: unknown): Promise<void> {
        const next = (state ?? {}) as { file?: string; mode?: MarkdownViewMode };
        if (next.mode) this.mode = next.mode;

        const vault = MarkdownView.vaultProvider?.();
        if (next.file && vault) {
            const file = vault.getAbstractFileByPath(next.file);
            this.file = file instanceof TFile ? file : null;
        }
        await this.render();
    }

    async onOpen(): Promise<void> {
        await this.render();
    }

    async onClose(): Promise<void> {
        await this.flush();
    }

    private async render(): Promise<void> {
        this.contentEl.empty();
        this.editorEl = null;
        this.previewEl = null;

        const vault = MarkdownView.vaultProvider?.();
        if (!this.file || !vault) {
            this.contentEl.createDiv({ cls: 'markdown-empty', text: 'No file open' });
            return;
        }

        const content = await vault.cachedRead(this.file);

        if (this.mode === 'preview') {
            this.previewEl = this.contentEl.createDiv({ cls: 'markdown-preview-view' });
            await MarkdownRenderer.render(null, content, this.previewEl, this.file.path, this);
            return;
        }

        this.editorEl = this.contentEl.createEl('textarea', { cls: 'markdown-source-view' });
        this.editorEl.value = content;
        this.editorEl.addEventListener('input', () => this.scheduleSave());
    }

    /** Debounced autosave; Phase 5's editor keeps the same contract. */
    private scheduleSave(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => void this.flush(), 500);
    }

    private async flush(): Promise<void> {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        const vault = MarkdownView.vaultProvider?.();
        if (!this.editorEl || !this.file || !vault) return;
        await vault.modify(this.file, this.editorEl.value);
    }
}
