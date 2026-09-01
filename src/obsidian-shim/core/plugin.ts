/**
 * Plugin base class.
 *
 * Everything the plugin registers -- 5 views, 20 commands, 5 ribbon icons, 26
 * events, 1 setting tab -- lands in registries the app shell reads back. In Obsidian
 * these were fire-and-forget because the host owned the registry; here we own it, so
 * the shell renders the command palette and ribbon straight from these maps.
 */
import { Component } from './component';
import type { App } from '../app';

export interface Command {
    id: string;
    name: string;
    callback?: () => unknown;
    checkCallback?: (checking: boolean) => boolean | void;
    icon?: string;
    hotkeys?: { modifiers: string[]; key: string }[];
}

export interface RibbonAction {
    icon: string;
    title: string;
    callback: (event: MouseEvent) => unknown;
}

export interface ViewCreator {
    (leaf: unknown): unknown;
}

export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    dir?: string;
}

export abstract class Plugin extends Component {
    readonly commands = new Map<string, Command>();
    readonly ribbonActions: RibbonAction[] = [];
    readonly viewCreators = new Map<string, ViewCreator>();
    settingTab: { display(): void; hide?(): void } | null = null;

    constructor(readonly app: App, readonly manifest: PluginManifest) {
        super();
    }

    addCommand(command: Command): Command {
        this.commands.set(command.id, command);
        this.register(() => this.commands.delete(command.id));
        return command;
    }

    addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
        const action: RibbonAction = { icon, title, callback };
        this.ribbonActions.push(action);
        this.register(() => {
            const at = this.ribbonActions.indexOf(action);
            if (at >= 0) this.ribbonActions.splice(at, 1);
        });
        // Obsidian returns the created element; the shell owns rendering, so this is a
        // detached stand-in for the handful of callers that style the returned node.
        return document.createElement('div');
    }

    addStatusBarItem(): HTMLElement {
        return document.createElement('div');
    }

    registerView(type: string, creator: ViewCreator): void {
        this.viewCreators.set(type, creator);
        this.register(() => this.viewCreators.delete(type));
    }

    addSettingTab(tab: { display(): void; hide?(): void }): void {
        this.settingTab = tab;
        this.register(() => { this.settingTab = null; });
    }

    /** Settings live at <vault>/.osint-copilot/data.json, not in a plugin folder. */
    async loadData(): Promise<unknown> {
        try {
            return JSON.parse(await this.app.vault.adapter.read(DATA_PATH));
        } catch {
            return null;
        }
    }

    async saveData(data: unknown): Promise<void> {
        await this.app.vault.adapter.mkdir(DATA_DIR);
        await this.app.vault.adapter.write(DATA_PATH, JSON.stringify(data, null, 2));
    }
}

const DATA_DIR = '.osint-copilot';
const DATA_PATH = `${DATA_DIR}/data.json`;
