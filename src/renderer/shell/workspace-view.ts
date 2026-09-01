/**
 * Renders the workspace layout tree into the DOM.
 *
 * A pure renderer over Workspace: it holds no layout state of its own. The leaf tree
 * in the shim IS the tab model, so there is nothing here to keep in sync with it --
 * which is exactly the drift the two-object design would have caused.
 */
import type { Workspace } from '../../obsidian-shim/workspace/workspace';
import { WorkspaceLeaf, WorkspaceTabs, type WorkspaceItem } from '../../obsidian-shim/workspace/layout';
import { setIcon } from '../../obsidian-shim/ui/set-icon';

export class WorkspaceRenderer {
    constructor(private readonly workspace: Workspace, private readonly mount: HTMLElement) {
        workspace.on('layout-change', () => this.render());
        workspace.on('active-leaf-change', () => this.render());
    }

    render(): void {
        this.mount.empty();
        this.renderContainer(this.workspace.rootSplit, this.mount);
    }

    private renderContainer(node: WorkspaceItem, into: HTMLElement): void {
        if (node instanceof WorkspaceTabs) {
            this.renderTabGroup(node, into);
            return;
        }
        const children = (node as { children?: WorkspaceItem[] }).children ?? [];
        for (const child of children) this.renderContainer(child, into);
    }

    private renderTabGroup(group: WorkspaceTabs, into: HTMLElement): void {
        const wrapper = into.createDiv({ cls: 'tab-group' });
        const strip = wrapper.createDiv({ cls: 'tab-strip' });
        const body = wrapper.createDiv({ cls: 'tab-body' });

        group.children.forEach((child, index) => {
            if (!(child instanceof WorkspaceLeaf)) return;
            const isActive = index === group.activeIndex;

            const tab = strip.createDiv({ cls: isActive ? 'tab is-active' : 'tab' });
            const icon = tab.createSpan({ cls: 'tab-icon' });
            setIcon(icon, child.view.getIcon());
            tab.createSpan({ cls: 'tab-title', text: child.view.getDisplayText() });

            const close = tab.createSpan({ cls: 'tab-close', text: '×' });
            close.addEventListener('click', (event) => {
                event.stopPropagation();
                child.detach();
            });
            tab.addEventListener('click', () => void this.workspace.revealLeaf(child));

            if (isActive) body.appendChild(child.view.containerEl);
        });

        if (group.children.length === 0) {
            body.createDiv({ cls: 'tab-empty', text: 'No open tabs' });
        }
    }
}
