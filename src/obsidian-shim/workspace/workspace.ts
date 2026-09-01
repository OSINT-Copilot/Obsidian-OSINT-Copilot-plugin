/**
 * Workspace -- leaf placement, view registration and layout events.
 *
 * The API surface here is exactly what osint-workspace-controller.ts (33 of the 43
 * workspace call sites) and the five views actually use. Nothing speculative.
 *
 * Deliberately NOT implemented: deferred/lazy views. Obsidian 1.7+ defers
 * constructing views for restored background tabs; copying that would make
 * getLeavesOfType(GRAPH_VIEW_TYPE) (12 call sites) miss background graph tabs, and
 * osint-workspace-controller.ts:130 casts a leaf's view to GraphView and calls a
 * method on it. Views are constructed eagerly.
 */
import { WorkspaceLeaf, WorkspaceRoot, WorkspaceSplit, WorkspaceTabs, type WorkspaceItem } from './layout';
import { EmptyView, View } from './view';
import type { TFile } from '../vault/tfile';

export type WorkspaceEventName = 'active-leaf-change' | 'layout-change' | 'file-open' | 'quit';

/** Argument shape per event, so handlers are typed at the call site. */
export interface WorkspaceEventMap {
    'active-leaf-change': [WorkspaceLeaf | null];
    'layout-change': [];
    'file-open': [TFile | null];
    quit: [];
}

type Handler = (...args: never[]) => void;

export interface WorkspaceEventRef {
    name: WorkspaceEventName;
    handler: Handler;
    detach(): void;
}

export interface ViewState {
    type: string;
    active?: boolean;
    state?: Record<string, unknown>;
}

export type ViewFactory = (leaf: WorkspaceLeaf) => View;

/** 'tab' = new tab in the active group; 'split' = new pane; false = reuse active. */
export type LeafTarget = boolean | 'tab' | 'split' | 'window';

export class Workspace {
    /** Set by App so constructed views can expose `this.app`. */
    app: import('../app').App | null = null;

    readonly rootSplit = new WorkspaceRoot('root');
    readonly leftSplit = new WorkspaceRoot('left');
    readonly rightSplit = new WorkspaceRoot('right');

    activeLeaf: WorkspaceLeaf | null = null;

    private readonly factories = new Map<string, ViewFactory>();
    private readonly handlers = new Map<WorkspaceEventName, Set<Handler>>();
    private recentLeaves: WorkspaceLeaf[] = [];

    constructor() {
        // The editor area always has at least one tab group to place leaves into.
        this.rootSplit.addChild(new WorkspaceTabs());
    }

    // ------------------------------------------------------------- registration

    registerViewFactory(type: string, factory: ViewFactory): void {
        this.factories.set(type, factory);
    }

    unregisterViewFactory(type: string): void {
        this.factories.delete(type);
    }

    // ------------------------------------------------------------------- events

    on<K extends WorkspaceEventName>(
        name: K,
        handler: (...args: WorkspaceEventMap[K]) => unknown,
    ): WorkspaceEventRef {
        if (!this.handlers.has(name)) this.handlers.set(name, new Set());
        this.handlers.get(name)!.add(handler as Handler);
        return { name, handler: handler as Handler, detach: () => this.handlers.get(name)?.delete(handler as Handler) };
    }

    offref(ref: WorkspaceEventRef | null | undefined): void {
        ref?.detach();
    }

    trigger<K extends WorkspaceEventName>(name: K, ...args: WorkspaceEventMap[K]): void {
        for (const handler of [...(this.handlers.get(name) ?? [])]) {
            (handler as (...a: unknown[]) => void)(...args);
        }
    }

    // ----------------------------------------------------------------- querying

    iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void {
        for (const root of [this.rootSplit, this.leftSplit, this.rightSplit]) {
            this.walk(root, callback);
        }
    }

    getLeavesOfType(type: string): WorkspaceLeaf[] {
        const found: WorkspaceLeaf[] = [];
        this.iterateAllLeaves((leaf) => {
            if (leaf.view.getViewType() === type) found.push(leaf);
        });
        return found;
    }

    detachLeavesOfType(type: string): void {
        for (const leaf of this.getLeavesOfType(type)) leaf.detach();
        this.trigger('layout-change');
    }

    getMostRecentLeaf(): WorkspaceLeaf | null {
        for (const leaf of this.recentLeaves) {
            if (this.isAttached(leaf)) return leaf;
        }
        return this.activeLeaf;
    }

    // ---------------------------------------------------------------- placement

    getLeaf(target: LeafTarget = false): WorkspaceLeaf {
        if (target === false && this.activeLeaf && this.isAttached(this.activeLeaf)) {
            return this.activeLeaf;
        }
        if (target === 'split') {
            const split = new WorkspaceSplit('vertical');
            const tabs = new WorkspaceTabs();
            split.addChild(tabs);
            this.rootSplit.addChild(split);
            return this.createLeafIn(tabs);
        }
        return this.createLeafIn(this.activeTabGroup());
    }

    getRightLeaf(_split: boolean): WorkspaceLeaf {
        const tabs = this.tabGroupOf(this.rightSplit);
        return this.createLeafIn(tabs);
    }

    getLeftLeaf(_split: boolean): WorkspaceLeaf {
        const tabs = this.tabGroupOf(this.leftSplit);
        return this.createLeafIn(tabs);
    }

    /**
     * Opens a new tab immediately after `anchor`, in the same group.
     * This is the mechanism behind Ctrl/Cmd-click on all five ribbon icons.
     */
    async duplicateLeaf(anchor: WorkspaceLeaf, _target: LeafTarget = 'tab'): Promise<WorkspaceLeaf> {
        const group = anchor.parent as WorkspaceTabs | null;
        if (!(group instanceof WorkspaceTabs)) return this.getLeaf('tab');

        const leaf = new WorkspaceLeaf(new EmptyView(null as unknown as WorkspaceLeaf));
        this.attachLeaf(leaf, group, group.children.indexOf(anchor) + 1);
        await leaf.setViewState(anchor.getViewState() as ViewState);
        return leaf;
    }

    async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
        const group = leaf.parent;
        if (group instanceof WorkspaceTabs) group.setActive(leaf);
        this.setActiveLeaf(leaf);
    }

    setActiveLeaf(leaf: WorkspaceLeaf | null, _focus = true): void {
        this.activeLeaf = leaf;
        if (leaf) {
            this.recentLeaves = [leaf, ...this.recentLeaves.filter((l) => l !== leaf)].slice(0, 20);
        }
        this.trigger('active-leaf-change', leaf);
    }

    // ------------------------------------------------------------------ private

    private walk(node: WorkspaceItem, callback: (leaf: WorkspaceLeaf) => void): void {
        if (node instanceof WorkspaceLeaf) {
            callback(node);
            return;
        }
        const children = (node as { children?: WorkspaceItem[] }).children;
        if (children) for (const child of [...children]) this.walk(child, callback);
    }

    private isAttached(leaf: WorkspaceLeaf): boolean {
        let found = false;
        this.iterateAllLeaves((l) => { if (l === leaf) found = true; });
        return found;
    }

    private activeTabGroup(): WorkspaceTabs {
        if (this.activeLeaf?.parent instanceof WorkspaceTabs && this.isAttached(this.activeLeaf)) {
            return this.activeLeaf.parent;
        }
        return this.tabGroupOf(this.rootSplit);
    }

    private tabGroupOf(root: WorkspaceRoot): WorkspaceTabs {
        const existing = this.firstTabGroup(root);
        if (existing) return existing;
        const tabs = new WorkspaceTabs();
        root.addChild(tabs);
        return tabs;
    }

    private firstTabGroup(node: WorkspaceItem): WorkspaceTabs | null {
        if (node instanceof WorkspaceTabs) return node;
        const children = (node as { children?: WorkspaceItem[] }).children ?? [];
        for (const child of children) {
            const found = this.firstTabGroup(child);
            if (found) return found;
        }
        return null;
    }

    private createLeafIn(group: WorkspaceTabs): WorkspaceLeaf {
        const leaf = new WorkspaceLeaf(new EmptyView(null as unknown as WorkspaceLeaf));
        this.attachLeaf(leaf, group);
        return leaf;
    }

    private attachLeaf(leaf: WorkspaceLeaf, group: WorkspaceTabs, index?: number): void {
        group.addChild(leaf, index);
        group.setActive(leaf);
        leaf.onStateChange = () => this.trigger('layout-change');
        this.bindSetViewState(leaf);
        this.setActiveLeaf(leaf);
        this.trigger('layout-change');
    }

    /**
     * setViewState lives on the leaf but needs the factory registry, so the workspace
     * installs it at attach time rather than making every leaf hold a workspace ref.
     */
    private bindSetViewState(leaf: WorkspaceLeaf): void {
        leaf.setViewState = async (state: ViewState): Promise<void> => {
            const factory = this.factories.get(state.type);
            const previous = leaf.view;
            const next = factory ? factory(leaf) : new EmptyView(leaf);
            if (this.app) next.app = this.app;

            if (previous && previous !== next) previous.unload();
            leaf.view = next;
            if (state.state !== undefined) await next.setState(state.state);
            next.load();

            if (state.active !== false) await this.revealLeaf(leaf);
            this.trigger('layout-change');
        };

        leaf.openFile = async (file: TFile): Promise<void> => {
            await leaf.setViewState({ type: 'markdown', active: true, state: { file: file.path } });
            this.trigger('file-open', file);
        };
    }
}

declare module './layout' {
    interface WorkspaceLeaf {
        setViewState(state: ViewState): Promise<void>;
        openFile(file: TFile): Promise<void>;
    }
}
