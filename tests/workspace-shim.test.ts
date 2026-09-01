import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Workspace } from '../src/obsidian-shim/workspace/workspace';
import { WorkspaceTabs } from '../src/obsidian-shim/workspace/layout';
import { ItemView } from '../src/obsidian-shim/workspace/view';
import { installDomExtensions } from '../src/obsidian-shim/dom/dom-extensions';

installDomExtensions();

class FakeView extends ItemView {
    constructor(leaf: never, private readonly type: string) { super(leaf); }
    getViewType() { return this.type; }
    refreshed = 0;
    refresh() { this.refreshed++; }
}

const GRAPH = 'osint-graph';
const CHAT = 'osint-chat';

describe('Workspace: the operations osint-workspace-controller depends on', () => {
    let workspace: Workspace;

    beforeEach(() => {
        workspace = new Workspace();
        workspace.registerViewFactory(GRAPH, (leaf) => new FakeView(leaf as never, GRAPH));
        workspace.registerViewFactory(CHAT, (leaf) => new FakeView(leaf as never, CHAT));
    });

    it('a main-area leaf reports rootSplit as its root (the controller filters on this)', async () => {
        const leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: GRAPH });
        // osint-workspace-controller.ts:21 -- leaf.getRoot() === workspace.rootSplit
        expect(leaf.getRoot()).toBe(workspace.rootSplit);
    });

    it('a sidebar leaf does NOT report rootSplit', () => {
        expect(workspace.getRightLeaf(false).getRoot()).toBe(workspace.rightSplit);
    });

    it('getLeavesOfType finds leaves by their view type', async () => {
        const a = workspace.getLeaf('tab');
        await a.setViewState({ type: GRAPH });
        const b = workspace.getLeaf('tab');
        await b.setViewState({ type: CHAT });

        expect(workspace.getLeavesOfType(GRAPH)).toEqual([a]);
        expect(workspace.getLeavesOfType(CHAT)).toEqual([b]);
        expect(workspace.getLeavesOfType('nope')).toEqual([]);
    });

    it('views are constructed eagerly, so a background tab is still castable', async () => {
        const graph = workspace.getLeaf('tab');
        await graph.setViewState({ type: GRAPH });
        const chat = workspace.getLeaf('tab');
        await chat.setViewState({ type: CHAT, active: true });

        // The controller casts leaf.view to GraphView and calls refresh() on background
        // tabs; a deferred view would have no such method.
        const view = workspace.getLeavesOfType(GRAPH)[0].view as FakeView;
        expect(typeof view.refresh).toBe('function');
        view.refresh();
        expect(view.refreshed).toBe(1);
    });

    it('duplicateLeaf opens a new tab beside the anchor, in the same group', async () => {
        const anchor = workspace.getLeaf('tab');
        await anchor.setViewState({ type: GRAPH });
        const other = workspace.getLeaf('tab');
        await other.setViewState({ type: CHAT });

        const dup = await workspace.duplicateLeaf(anchor, 'tab');
        const group = anchor.parent as WorkspaceTabs;

        expect(dup.parent).toBe(group);
        expect(group.children.indexOf(dup)).toBe(group.children.indexOf(anchor) + 1);
        expect(dup.view.getViewType()).toBe(GRAPH);
        expect(workspace.getLeavesOfType(GRAPH)).toHaveLength(2);
    });

    it('getLeaf(false) reuses the active leaf; getLeaf("tab") does not', async () => {
        const first = workspace.getLeaf('tab');
        await first.setViewState({ type: GRAPH });
        expect(workspace.getLeaf(false)).toBe(first);
        expect(workspace.getLeaf('tab')).not.toBe(first);
    });

    it('detach removes the leaf and unloads its view', async () => {
        const leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: GRAPH });
        const closed = vi.spyOn(leaf.view, 'onClose');

        leaf.detach();

        expect(workspace.getLeavesOfType(GRAPH)).toEqual([]);
        expect(closed).toHaveBeenCalled();
    });

    it('detachLeavesOfType clears every matching leaf', async () => {
        for (const type of [GRAPH, GRAPH, CHAT]) {
            await workspace.getLeaf('tab').setViewState({ type });
        }
        workspace.detachLeavesOfType(GRAPH);
        expect(workspace.getLeavesOfType(GRAPH)).toEqual([]);
        expect(workspace.getLeavesOfType(CHAT)).toHaveLength(1);
    });

    it('revealLeaf makes the leaf active within its group', async () => {
        const a = workspace.getLeaf('tab');
        await a.setViewState({ type: GRAPH });
        const b = workspace.getLeaf('tab');
        await b.setViewState({ type: CHAT });

        await workspace.revealLeaf(a);
        expect(workspace.activeLeaf).toBe(a);
        expect((a.parent as WorkspaceTabs).activeLeaf).toBe(a);
    });

    it('fires active-leaf-change and layout-change', async () => {
        const active = vi.fn();
        const layout = vi.fn();
        workspace.on('active-leaf-change', active);
        workspace.on('layout-change', layout);

        await workspace.getLeaf('tab').setViewState({ type: GRAPH });

        expect(active).toHaveBeenCalled();
        expect(layout).toHaveBeenCalled();
    });

    it('offref stops delivery', () => {
        const handler = vi.fn();
        workspace.offref(workspace.on('layout-change', handler));
        workspace.getLeaf('tab');
        expect(handler).not.toHaveBeenCalled();
    });

    it('iterateAllLeaves covers all three roots', async () => {
        await workspace.getLeaf('tab').setViewState({ type: GRAPH });
        await workspace.getRightLeaf(false).setViewState({ type: CHAT });

        const seen: string[] = [];
        workspace.iterateAllLeaves((leaf) => seen.push(leaf.view.getViewType()));
        expect(seen.sort()).toEqual([CHAT, GRAPH].sort());
    });
});

describe('View container structure', () => {
    it('mounts content at containerEl.children[1], as all five views assume', async () => {
        const workspace = new Workspace();
        workspace.registerViewFactory(GRAPH, (leaf) => new FakeView(leaf as never, GRAPH));
        const leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: GRAPH });

        const view = leaf.view;
        // graph-view.ts:285, chat-view.ts:395, map-view.ts:73, timeline-view.ts:91,
        // tools-skills-registry-view.ts:206 all do containerEl.children[1].
        expect(view.containerEl.children).toHaveLength(2);
        expect(view.containerEl.children[1]).toBe(view.contentEl);
    });
});
