/**
 * App -- the object 34 files take in their constructor.
 *
 * Workspace is deliberately absent until Phase 3: the workspace shim and the shell's
 * tab manager must be the SAME object (osint-workspace-controller compares
 * leaf.getRoot() to workspace.rootSplit and reads leaf.view.getViewType()), so
 * standing up a placeholder now would guarantee two layouts that drift.
 */
import { Vault } from './vault/vault';
import { MetadataCache } from './core/metadata-cache';
import { hostStorage } from './vault/storage';
import { host } from '../host';
import type { TAbstractFile } from './vault/tfile';

export class App {
    readonly vault: Vault;
    readonly metadataCache: MetadataCache;

    readonly fileManager = {
        /**
         * Obsidian routes deletes here so the user's "move to trash vs delete" setting
         * is respected; 4 call sites depend on it.
         */
        trashFile: async (file: TAbstractFile): Promise<void> => {
            await this.vault.trash(file);
        },
        getNewFileParent: () => this.vault.root,
    };

    constructor(vault: Vault) {
        this.vault = vault;
        this.metadataCache = new MetadataCache(vault);
    }

    /** Opens a folder as the vault. A vault is just a directory. */
    static async open(dir: string): Promise<App> {
        const vault = new Vault(hostStorage(host, dir));
        await vault.open();
        return new App(vault);
    }
}
