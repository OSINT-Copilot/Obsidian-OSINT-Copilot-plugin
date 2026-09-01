/**
 * The layout tree: splits, tab groups, and leaves.
 *
 * This IS the app's tab manager, not a façade over one. osint-workspace-controller
 * compares `leaf.getRoot() === workspace.rootSplit` (line 21) and reads
 * `leaf.view.getViewType()` (line 31) to decide where a pane goes -- if the tab
 * manager were a separate object that a Workspace shim proxied, those comparisons
 * would be meaningless and all 306 lines of that controller would silently misplace
 * every pane. The shell renders this tree; it does not own a second one.
 */

export type SplitDirection = 'horizontal' | 'vertical';

export abstract class WorkspaceItem {
    parent: WorkspaceParent | null = null;

    /** Walks up to the containing root (rootSplit, leftSplit or rightSplit). */
    getRoot(): WorkspaceItem {
        let node: WorkspaceItem = this;
        while (node.parent && !(node.parent instanceof WorkspaceRoot)) node = node.parent;
        return node.parent ?? node;
    }

    getContainer(): WorkspaceItem {
        return this.getRoot();
    }
}

export abstract class WorkspaceParent extends WorkspaceItem {
    children: WorkspaceItem[] = [];

    addChild(child: WorkspaceItem, index?: number): void {
        child.parent = this;
        if (index === undefined || index >= this.children.length) this.children.push(child);
        else this.children.splice(index, 0, child);
    }

    removeChild(child: WorkspaceItem): void {
        const at = this.children.indexOf(child);
        if (at >= 0) this.children.splice(at, 1);
        child.parent = null;
    }
}

/** A horizontal or vertical split containing other splits or tab groups. */
export class WorkspaceSplit extends WorkspaceParent {
    constructor(public direction: SplitDirection = 'vertical') {
        super();
    }
}

/** A group of leaves sharing one tab strip. */
export class WorkspaceTabs extends WorkspaceParent {
    activeIndex = 0;

    get activeLeaf(): WorkspaceLeaf | null {
        return (this.children[this.activeIndex] as WorkspaceLeaf) ?? null;
    }

    setActive(leaf: WorkspaceLeaf): void {
        const at = this.children.indexOf(leaf);
        if (at >= 0) this.activeIndex = at;
    }
}

/** A top-level container: the editor area, or a sidebar. */
export class WorkspaceRoot extends WorkspaceParent {
    constructor(readonly kind: 'root' | 'left' | 'right') {
        super();
    }

    /** Roots terminate the walk. */
    getRoot(): WorkspaceItem {
        return this;
    }
}

/**
 * A leaf: exactly one tab, holding exactly one view.
 * `WorkspaceLeaf` IS the tab -- there is no separate tab object anywhere.
 */
export class WorkspaceLeaf extends WorkspaceItem {
    view: import('./view').View;
    /** Set by the workspace so the leaf can notify on view/state changes. */
    onStateChange: (() => void) | null = null;

    constructor(view: import('./view').View) {
        super();
        this.view = view;
    }

    getViewState(): { type: string; state?: Record<string, unknown> } {
        return { type: this.view.getViewType(), state: this.view.getState() };
    }

    getDisplayText(): string {
        return this.view.getDisplayText();
    }

    detach(): void {
        this.view.unload();
        (this.parent as WorkspaceParent | null)?.removeChild(this);
        this.onStateChange?.();
    }
}
