/**
 * App -- the object 34 files take in their constructor.
 *
 * `workspace` is the real layout tree, not a façade over a separate tab manager:
 * osint-workspace-controller compares leaf.getRoot() to workspace.rootSplit and
 * reads leaf.view.getViewType(), so two synchronised layouts would silently
 * misplace every pane.
 */
import { Vault } from './vault/vault';
import { MetadataCache } from './core/metadata-cache';
import { Workspace } from './workspace/workspace';
import { hostStorage } from './vault/storage';
import { host } from '../host';
import type { TAbstractFile, TFile } from './vault/tfile';

export class App {
    readonly vault: Vault;
    readonly metadataCache: MetadataCache;
    readonly workspace = new Workspace();

    /**
     * Internal drag state. graph-view.ts:430 and chat-view.ts:609 read
     * `app.dragManager.draggable.file` to accept vault files dropped from the
     * explorer; both already fall back to text/plain, so this is an enhancement
     * rather than a hard dependency.
     */
    readonly dragManager: { draggable: { type: string; file: TFile; files: TFile[] } | null } = { draggable: null };

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
        this.workspace.app = this;
    }

    /** Opens a folder as the vault. A vault is just a directory. */
    static async open(dir: string): Promise<App> {
        const vault = new Vault(hostStorage(host, dir));
        await vault.open();
        return new App(vault);
    }
}
