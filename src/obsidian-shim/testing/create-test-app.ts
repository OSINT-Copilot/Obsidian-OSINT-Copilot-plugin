/**
 * A real `App` for tests: the production Vault, backed by in-memory storage.
 *
 * Deliberately not a hand-written fake. The Vault here is the same class the app
 * runs, so its index tree, event timing, cachedRead behaviour and Obsidian error
 * strings are all exercised by every test that touches a file.
 */

import { Vault } from '../vault/vault';
import { MemoryStorage } from '../vault/storage';
import { TAbstractFile, TFile } from '../vault/tfile';

export interface TestApp {
    vault: Vault;
    /** The in-memory backend, for synchronous assertions. */
    storage: MemoryStorage;
    fileManager: { trashFile(file: TAbstractFile): Promise<void> };
    metadataCache: { getFileCache(file: TFile): Record<string, unknown> | null };
    workspace: {
        getLeaf(): { openFile(file: TFile): Promise<void> };
        getLeavesOfType(): unknown[];
        openedFiles: string[];
    };
}

export interface TestAppOptions {
    /** Seed files as { "path/to/note.md": "contents" }. Folders are created for you. */
    files?: Record<string, string>;
}

export async function createTestAppAsync(options: TestAppOptions = {}): Promise<TestApp> {
    const storage = new MemoryStorage();
    for (const [path, contents] of Object.entries(options.files ?? {})) {
        await storage.write(path, contents);
    }

    const vault = new Vault(storage);
    await vault.open();

    const openedFiles: string[] = [];
    return {
        vault,
        storage,
        fileManager: {
            async trashFile(file: TAbstractFile) { await vault.trash(file); },
        },
        metadataCache: { getFileCache: () => null },
        workspace: {
            getLeaf: () => ({
                async openFile(file: TFile) { openedFiles.push(file.path); },
            }),
            getLeavesOfType: () => [],
            openedFiles,
        },
    };
}

/**
 * Synchronous convenience wrapper. The seeded files and the index are populated on a
 * microtask, so a test that seeds files must `await appReady(app)` before asserting
 * on them; tests that only create entities through EntityManager need not.
 */
export function createTestApp(options: TestAppOptions = {}): TestApp {
    const storage = new MemoryStorage();
    const vault = new Vault(storage);
    const openedFiles: string[] = [];

    const ready = (async () => {
        for (const [path, contents] of Object.entries(options.files ?? {})) {
            await storage.write(path, contents);
        }
        await vault.open();
    })();

    const app: TestApp & { __ready: Promise<void> } = {
        vault,
        storage,
        fileManager: {
            async trashFile(file: TAbstractFile) { await vault.trash(file); },
        },
        metadataCache: { getFileCache: () => null },
        workspace: {
            getLeaf: () => ({
                async openFile(file: TFile) { openedFiles.push(file.path); },
            }),
            getLeavesOfType: () => [],
            openedFiles,
        },
        __ready: ready,
    };
    return app;
}

/** Awaits the seeding started by createTestApp. */
export function appReady(app: TestApp): Promise<void> {
    return (app as TestApp & { __ready?: Promise<void> }).__ready ?? Promise.resolve();
}
