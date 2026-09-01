/**
 * A real `App` backed by MemoryVault.
 *
 * Before this existed, every vault-touching test used vi.fn() stubs, which is why
 * the 27 vault-consuming files (entity-manager alone has 53 vault call sites) had
 * no behavioural coverage at all. This is the harness the Phase 0 characterization
 * tests and golden fixtures are built on.
 */

import { MemoryVault } from './memory-vault';
import { TAbstractFile, TFile } from '../vault/tfile';

export interface TestApp {
    vault: MemoryVault;
    fileManager: { trashFile(file: TAbstractFile): Promise<void> };
    metadataCache: { getFileCache(file: TFile): Record<string, unknown> | null };
    workspace: {
        getLeaf(): { openFile(file: TFile): Promise<void> };
        getLeavesOfType(): unknown[];
        openedFiles: string[];
    };
}

export interface TestAppOptions {
    /** Seed files as { "path/to/note.md": "contents" }. Parent folders are created for you. */
    files?: Record<string, string>;
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
    const vault = new MemoryVault();
    const openedFiles: string[] = [];

    const app: TestApp = {
        vault,
        fileManager: {
            async trashFile(file: TAbstractFile) {
                await vault.trash(file);
            },
        },
        metadataCache: {
            getFileCache: () => null,
        },
        workspace: {
            getLeaf: () => ({
                async openFile(file: TFile) {
                    openedFiles.push(file.path);
                },
            }),
            getLeavesOfType: () => [],
            openedFiles,
        },
    };

    for (const [path, contents] of Object.entries(options.files ?? {})) {
        seedFile(vault, path, contents);
    }

    return app;
}

/**
 * Seed a file, creating the folder chain first.
 *
 * Note this mirrors vault-bootstrap-fs.ensureFolderChain rather than using a
 * recursive mkdir: MemoryVault.createFolder is deliberately non-recursive because
 * Obsidian's is, and production code depends on that.
 */
export function seedFile(vault: MemoryVault, path: string, contents: string): void {
    const segments = path.split('/');
    segments.pop();
    let sofar = '';
    for (const segment of segments) {
        sofar = sofar ? `${sofar}/${segment}` : segment;
        if (!vault.getAbstractFileByPath(sofar)) void vault.createFolder(sofar);
    }
    void vault.create(path, contents);
}
