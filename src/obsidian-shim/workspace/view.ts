/**
 * View / ItemView.
 *
 * containerEl's two-child structure is NOT cosmetic. All five registered views mount
 * into `this.containerEl.children[1]` -- graph-view.ts:285, chat-view.ts:395,
 * map-view.ts:73, timeline-view.ts:91, tools-skills-registry-view.ts:206,482 --
 * because Obsidian's view container is [header, content]. Get this wrong and every
 * view mounts into the header and renders blank, with no error.
 */
import { Component } from '../core/component';
import type { WorkspaceLeaf } from './layout';

export abstract class View extends Component {
    /**
     * Obsidian's View exposes `app`, and the five views use `this.app` 84 times.
     * The workspace injects it when it constructs a view, since the view factory
     * signature only carries a leaf.
     */
    app!: import('../app').App;
    containerEl: HTMLElement;
    /** The content half of containerEl; identical to containerEl.children[1]. */
    contentEl: HTMLElement;
    headerEl: HTMLElement;

    constructor(readonly leaf: WorkspaceLeaf) {
        super();
        this.containerEl = document.createElement('div');
        this.containerEl.addClass('workspace-leaf-content');

        this.headerEl = this.containerEl.createDiv({ cls: 'view-header' });
        this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
    }

    abstract getViewType(): string;

    getDisplayText(): string {
        return this.getViewType();
    }

    getIcon(): string {
        return 'document';
    }

    getState(): Record<string, unknown> {
        return {};
    }

    async setState(_state: unknown): Promise<void> { /* subclasses override */ }

    async onOpen(): Promise<void> { /* subclasses override */ }

    async onClose(): Promise<void> { /* subclasses override */ }

    onload(): void {
        void this.onOpen();
    }

    onunload(): void {
        void this.onClose();
    }

    /** Obsidian adds a header action button; the shell renders these. */
    addAction(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
        const button = this.headerEl.createEl('button', { cls: 'view-action', attr: { 'aria-label': title } });
        button.dataset.icon = icon;
        button.addEventListener('click', callback);
        return button;
    }
}

export abstract class ItemView extends View {}

/** Placeholder view for an empty tab. */
export class EmptyView extends ItemView {
    getViewType(): string {
        return 'empty';
    }

    getDisplayText(): string {
        return 'New tab';
    }
}

/**
 * Editor -- imported by vault-ai-plugin.ts:3 but never used. Kept as a real (empty)
 * class so the import resolves; Phase 5 replaces it with the CodeMirror surface.
 */
export class Editor {
    getValue(): string { return ''; }
    setValue(_value: string): void { /* replaced in Phase 5 */ }
}
