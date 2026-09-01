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

/**
 * Injected by the renderer so the shim does not depend on the shell. Keeps the
 * CodeMirror bundle out of any build that only needs the shim (the plugin target).
 */
export interface EditorFactory {
    (parent: HTMLElement, options: {
        initialText: string;
        onChange(text: string): void;
        linkTargets(): string[];
    }): { getValue(): string; flush(): void; destroy(): void; focus(): void };
}

export type MarkdownViewMode = 'source' | 'preview';

export const MARKDOWN_VIEW_TYPE = 'markdown';

export class MarkdownView extends ItemView {
    file: TFile | null = null;
    private mode: MarkdownViewMode = 'source';
    private editor: ReturnType<EditorFactory> | null = null;
    private previewEl: HTMLElement | null = null;

    /** Injected by the app so the view can read and write without an App reference. */
    static vaultProvider: (() => Vault | null) | null = null;
    /** Injected by the renderer; falls back to a plain textarea when absent. */
    static editorFactory: EditorFactory | null = null;

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
        this.editor?.destroy();
        this.editor = null;
        this.contentEl.empty();
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

        const host = this.contentEl.createDiv({ cls: 'markdown-source-view' });
        if (MarkdownView.editorFactory) {
            this.editor = MarkdownView.editorFactory(host, {
                initialText: content,
                onChange: (text) => { void this.save(text); },
                linkTargets: () => vault.getMarkdownFiles().map((f) => f.basename),
            });
            return;
        }

        // Fallback for builds without the shell (e.g. tests): a plain textarea.
        const textarea = host.createEl('textarea', { cls: 'markdown-source-fallback' });
        textarea.value = content;
        textarea.addEventListener('change', () => void this.save(textarea.value));
    }

    private async save(text: string): Promise<void> {
        const vault = MarkdownView.vaultProvider?.();
        if (!this.file || !vault) return;
        await vault.modify(this.file, text);
    }

    private async flush(): Promise<void> {
        this.editor?.flush();
    }
}
