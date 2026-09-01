/**
 * TAbstractFile / TFile / TFolder.
 *
 * These must be real classes, not POJOs: the codebase does `instanceof TFile`
 * 86 times and `instanceof TFolder` 19 times as the file-vs-folder discriminator.
 *
 * Only the fields actually read anywhere in src/ are modelled:
 *   TFile   -> path, name, basename, extension, parent, stat.{mtime,ctime,size}
 *   TFolder -> path, name, parent, children, isRoot()
 */

export interface FileStats {
    ctime: number;
    mtime: number;
    size: number;
}

export abstract class TAbstractFile {
    path = '';
    name = '';
    parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
    stat: FileStats = { ctime: 0, mtime: 0, size: 0 };
    basename = '';
    extension = '';
}

export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];

    isRoot(): boolean {
        return this.path === '/';
    }
}

/** Split "a/b/c.md" into basename "c" and extension "md" (extension "" when absent). */
export function splitName(name: string): { basename: string; extension: string } {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return { basename: name, extension: '' };
    return { basename: name.slice(0, dot), extension: name.slice(dot + 1) };
}

export function makeFile(path: string, parent: TFolder | null, stat?: Partial<FileStats>): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.slice(path.lastIndexOf('/') + 1);
    const { basename, extension } = splitName(file.name);
    file.basename = basename;
    file.extension = extension;
    file.parent = parent;
    file.stat = { ctime: 0, mtime: 0, size: 0, ...stat };
    return file;
}

export function makeFolder(path: string, parent: TFolder | null): TFolder {
    const folder = new TFolder();
    folder.path = path;
    folder.name = path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1);
    folder.parent = parent;
    return folder;
}
