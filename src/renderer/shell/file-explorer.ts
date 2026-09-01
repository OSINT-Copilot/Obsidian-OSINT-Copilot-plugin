/**
 * File explorer.
 *
 * Renders the Vault's own index tree -- it keeps no file list of its own, so it
 * cannot drift from what the rest of the app sees. Vault events (which fire
 * synchronously from writes, and from the watcher for out-of-band edits) drive
 * re-rendering.
 */
import type { App } from '../../obsidian-shim/app';
import { TAbstractFile, TFile, TFolder } from '../../obsidian-shim/vault/tfile';
import { Menu } from '../../obsidian-shim/ui/menu';
import { Notice } from '../../obsidian-shim/ui/notice';
import { setIcon } from '../../obsidian-shim/ui/set-icon';

export class FileExplorer {
    private collapsed = new Set<string>();
    private readonly listEl: HTMLElement;

    constructor(private readonly app: App, private readonly mount: HTMLElement) {
        this.mount.addClass('file-explorer');

        const header = this.mount.createDiv({ cls: 'explorer-header' });
        header.createSpan({ cls: 'explorer-title', text: 'Files' });
        const newNote = header.createSpan({ cls: 'explorer-action clickable-icon', attr: { 'aria-label': 'New note' } });
        setIcon(newNote, 'file-plus');
        newNote.addEventListener('click', () => void this.createNote(this.app.vault.root));

        this.listEl = this.mount.createDiv({ cls: 'explorer-list' });

        for (const event of ['create', 'delete', 'rename', 'modify'] as const) {
            this.app.vault.on(event, () => this.render());
        }
        this.render();
    }

    render(): void {
        this.listEl.empty();
        this.renderFolder(this.app.vault.root, this.listEl, 0);
    }

    private renderFolder(folder: TFolder, into: HTMLElement, depth: number): void {
        const children = [...folder.children].sort(compare);
        for (const child of children) {
            if (child instanceof TFolder) this.renderFolderRow(child, into, depth);
            else if (child instanceof TFile) this.renderFileRow(child, into, depth);
        }
    }

    private renderFolderRow(folder: TFolder, into: HTMLElement, depth: number): void {
        const isCollapsed = this.collapsed.has(folder.path);
        const row = into.createDiv({ cls: 'explorer-row explorer-folder' });
        row.setCssProps({ 'padding-left': `${depth * 14 + 8}px` });

        const chevron = row.createSpan({ cls: 'explorer-chevron' });
        setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');
        row.createSpan({ cls: 'explorer-name', text: folder.name });

        row.addEventListener('click', () => {
            if (isCollapsed) this.collapsed.delete(folder.path);
            else this.collapsed.add(folder.path);
            this.render();
        });
        row.addEventListener('contextmenu', (event) => this.showFolderMenu(event, folder));

        if (!isCollapsed) this.renderFolder(folder, into, depth + 1);
    }

    private renderFileRow(file: TFile, into: HTMLElement, depth: number): void {
        const row = into.createDiv({ cls: 'explorer-row explorer-file' });
        row.setCssProps({ 'padding-left': `${depth * 14 + 22}px` });
        row.createSpan({ cls: 'explorer-name', text: file.basename });

        row.addEventListener('click', () => void this.app.workspace.getLeaf(false).openFile(file));
        row.addEventListener('contextmenu', (event) => this.showFileMenu(event, file));

        // The explorer owns drag state; graph-view and chat-view read app.dragManager
        // to accept internal vault drops, and both already fall back to text/plain.
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (event) => {
            this.app.dragManager.draggable = { type: 'file', file, files: [file] };
            event.dataTransfer?.setData('text/plain', file.path);
        });
        row.addEventListener('dragend', () => { this.app.dragManager.draggable = null; });
    }

    private showFileMenu(event: MouseEvent, file: TFile): void {
        event.preventDefault();
        new Menu()
            .addItem((i) => i.setTitle('Open').setIcon('file-text')
                .onClick(() => void this.app.workspace.getLeaf(false).openFile(file)))
            .addItem((i) => i.setTitle('Open in new tab').setIcon('plus')
                .onClick(() => void this.app.workspace.getLeaf('tab').openFile(file)))
            .addItem((i) => i.setTitle('Rename…').setIcon('pencil')
                .onClick(() => void this.rename(file)))
            .addItem((i) => i.setTitle('Delete').setIcon('trash')
                .onClick(() => void this.remove(file)))
            .showAtMouseEvent(event);
    }

    private showFolderMenu(event: MouseEvent, folder: TFolder): void {
        event.preventDefault();
        new Menu()
            .addItem((i) => i.setTitle('New note').setIcon('file-plus')
                .onClick(() => void this.createNote(folder)))
            .addItem((i) => i.setTitle('New folder').setIcon('folder-plus')
                .onClick(() => void this.createFolder(folder)))
            .addItem((i) => i.setTitle('Delete').setIcon('trash')
                .onClick(() => void this.remove(folder)))
            .showAtMouseEvent(event);
    }

    private async createNote(parent: TFolder): Promise<void> {
        const name = window.prompt('Note name', 'Untitled');
        if (!name) return;
        const path = parent.isRoot() ? `${name}.md` : `${parent.path}/${name}.md`;
        try {
            const file = await this.app.vault.create(path, `# ${name}\n\n`);
            await this.app.workspace.getLeaf(false).openFile(file);
        } catch (error) {
            new Notice(`Could not create note: ${String(error)}`);
        }
    }

    private async createFolder(parent: TFolder): Promise<void> {
        const name = window.prompt('Folder name', 'New folder');
        if (!name) return;
        try {
            await this.app.vault.createFolder(parent.isRoot() ? name : `${parent.path}/${name}`);
        } catch (error) {
            new Notice(`Could not create folder: ${String(error)}`);
        }
    }

    private async rename(file: TAbstractFile): Promise<void> {
        const next = window.prompt('Rename to', file.name);
        if (!next || next === file.name) return;
        const parent = file.parent?.path;
        try {
            await this.app.vault.rename(file, parent && parent !== '/' ? `${parent}/${next}` : next);
        } catch (error) {
            new Notice(`Could not rename: ${String(error)}`);
        }
    }

    private async remove(file: TAbstractFile): Promise<void> {
        if (!window.confirm(`Move "${file.name}" to trash?`)) return;
        await this.app.fileManager.trashFile(file);
    }
}

/** Folders before files, then case-insensitive by name -- Obsidian's ordering. */
function compare(a: TAbstractFile, b: TAbstractFile): number {
    const aFolder = a instanceof TFolder;
    const bFolder = b instanceof TFolder;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
