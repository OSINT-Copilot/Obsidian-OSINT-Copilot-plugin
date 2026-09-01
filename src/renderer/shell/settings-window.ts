/**
 * Settings window.
 *
 * Hosts the plugin's existing PluginSettingTab unmodified -- all 68 Setting rows in
 * vault-ai-setting-tab.ts render through the Setting shim without edits.
 *
 * Also backs app.setting.open()/openTabById(), which chat-view.ts:450-452 calls
 * (with @ts-ignore) to jump the user straight to settings.
 */
import type { App } from '../../obsidian-shim/app';
import type { Plugin } from '../../obsidian-shim/core/plugin';

export class SettingsWindow {
    private overlay: HTMLElement | null = null;

    constructor(private readonly plugin: Plugin) {}

    open(): void {
        if (this.overlay) return;
        const tab = this.plugin.settingTab;
        if (!tab) return;

        this.overlay = document.body.createDiv({ cls: 'settings-overlay' });
        this.overlay.addEventListener('click', (event) => {
            if (event.target === this.overlay) this.close();
        });

        const panel = this.overlay.createDiv({ cls: 'settings-panel' });
        const header = panel.createDiv({ cls: 'settings-header' });
        header.createSpan({ cls: 'settings-title', text: 'Settings' });
        const close = header.createSpan({ cls: 'settings-close', text: '×' });
        close.addEventListener('click', () => this.close());

        const body = panel.createDiv({ cls: 'settings-body' });
        // The tab owns containerEl and re-renders into it after async saves; adopt it
        // rather than copying, so its own display() calls keep working.
        const container = (tab as unknown as { containerEl: HTMLElement }).containerEl;
        body.appendChild(container);
        container.empty();
        tab.display();

        this.escapeHandler = (event: KeyboardEvent) => { if (event.key === 'Escape') this.close(); };
        document.addEventListener('keydown', this.escapeHandler);
    }

    private escapeHandler: ((event: KeyboardEvent) => void) | null = null;

    close(): void {
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }
        this.plugin.settingTab?.hide?.();
        this.overlay?.remove();
        this.overlay = null;
    }

    /** Installs app.setting so chat-view's shortcut works. */
    install(app: App): void {
        (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting = {
            open: () => this.open(),
            openTabById: () => this.open(),
        };
    }
}
