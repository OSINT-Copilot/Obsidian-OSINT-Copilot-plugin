/**
 * Renderer entry: boots the real plugin against the shim.
 *
 * The plugin class is imported unchanged from main.ts -- the same source the frozen
 * Obsidian plugin builds from. esbuild aliases "obsidian" to src/obsidian-shim, so
 * all 42 coupled files compile and run here without edits.
 */
import { installDomExtensions } from '../obsidian-shim/dom/dom-extensions';
import { App } from '../obsidian-shim/app';
import { MarkdownView, MARKDOWN_VIEW_TYPE } from '../obsidian-shim/workspace/markdown-view';
import { Notice } from '../obsidian-shim/ui/notice';
import { host } from '../host';
import VaultAIPlugin from '../../main';
import { WorkspaceRenderer } from './shell/workspace-view';
import { renderRibbon } from './shell/ribbon';

installDomExtensions();

const MANIFEST = { id: 'osint-copilot', name: 'OSINT Copilot', version: '3.0.0-dev' };

async function chooseVault(): Promise<string | null> {
    // --vault=<dir> wins, so a headless smoke run needs no picker interaction.
    const forced = new URLSearchParams(location.search).get('vault')
        ?? (window as { __vaultArg?: string }).__vaultArg;
    if (forced) return forced;

    const remembered = await host.app.lastVault();
    if (remembered) return remembered;
    const picked = await host.app.pickVault();
    if (picked) await host.app.rememberVault(picked);
    return picked;
}

function renderChrome(root: HTMLElement): { ribbon: HTMLElement; main: HTMLElement } {
    root.empty();
    const shell = root.createDiv({ cls: 'app-shell' });
    const ribbon = shell.createDiv({ cls: 'ribbon' });
    const main = shell.createDiv({ cls: 'app-main' });
    return { ribbon, main };
}

function renderVaultPrompt(root: HTMLElement, onPick: () => void): void {
    root.empty();
    const pane = root.createDiv({ cls: 'vault-prompt' });
    pane.createEl('h1', { text: 'OSINT Copilot' });
    pane.createEl('p', { text: 'Open a folder to use as your vault. An existing Obsidian vault works as-is.' });
    const button = pane.createEl('button', { cls: 'setting-button mod-cta', text: 'Choose folder…' });
    button.addEventListener('click', onPick);
}

async function boot(): Promise<void> {
    const root = document.getElementById('app');
    if (!root) return;

    let dir = await chooseVault();
    if (!dir) {
        renderVaultPrompt(root, () => { void boot(); });
        root.setAttribute('data-boot', 'awaiting-vault');
        return;
    }

    const app = await App.open(dir);
    // MarkdownView needs vault access without an App reference; the workspace
    // constructs views from a factory that takes only a leaf.
    MarkdownView.vaultProvider = () => app.vault;
    app.workspace.registerViewFactory(MARKDOWN_VIEW_TYPE, (leaf) => new MarkdownView(leaf));

    const plugin = new VaultAIPlugin(app as never, MANIFEST as never);

    // registerView records a factory on the plugin; hand those to the workspace so
    // setViewState({type}) can construct the real views.
    const originalRegisterView = plugin.registerView.bind(plugin);
    plugin.registerView = (type, creator) => {
        originalRegisterView(type, creator);
        app.workspace.registerViewFactory(type, creator);
    };

    await plugin.onload();
    plugin.load();

    const { ribbon, main } = renderChrome(root);
    renderRibbon(plugin as never, ribbon);
    new WorkspaceRenderer(app.workspace, main).render();

    root.setAttribute('data-boot', 'ready');
    root.setAttribute('data-vault', dir);
    root.setAttribute('data-views', String(plugin.viewCreators.size));
    root.setAttribute('data-commands', String(plugin.commands.size));

    /** Test hook: open a registered view type without going through the ribbon. */
    (window as { __openView?: (type: string) => Promise<void> }).__openView = async (type: string) => {
        await app.workspace.getLeaf('tab').setViewState({ type, active: true });
    };

    window.addEventListener('beforeunload', () => plugin.unload());
    new Notice(`Vault opened: ${dir}`, 3000);
}

void boot().catch((error: unknown) => {
    const root = document.getElementById('app');
    console.error('[renderer] boot failed', error);
    if (root) {
        root.textContent = `Boot failed: ${String(error)}`;
        root.setAttribute('data-boot', 'failed');
    }
});

export {};
