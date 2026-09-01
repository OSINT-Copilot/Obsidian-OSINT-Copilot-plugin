import { describe, it, expect } from 'vitest';
import { Plugin } from '../src/obsidian-shim/core/plugin';
import { createTestApp, appReady } from '../src/obsidian-shim/testing/create-test-app';
import type { App } from '../src/obsidian-shim/app';

class TestPlugin extends Plugin {}

const MANIFEST = { id: 'osint-copilot', name: 'OSINT Copilot', version: '3.0.0' };

async function pluginFor(files: Record<string, string>) {
    const app = createTestApp({ files });
    await appReady(app);
    return { app, plugin: new TestPlugin(app as unknown as App, MANIFEST) };
}

describe('Settings migration from an Obsidian vault', () => {
    it('imports legacy plugin settings on first run', async () => {
        const legacy = JSON.stringify({ maxNotes: 42, apiProvider: 'codex' });
        const { app, plugin } = await pluginFor({
            '.obsidian/plugins/osint-copilot/data.json': legacy,
        });

        expect(await plugin.loadData()).toEqual({ maxNotes: 42, apiProvider: 'codex' });

        // Copied to the app's own location, so the next launch does not re-import.
        expect(JSON.parse(app.storage.peek('.osint-copilot/data.json')!)).toEqual({
            maxNotes: 42, apiProvider: 'codex',
        });
        // The old file is left alone: the frozen plugin may still be installed.
        expect(app.storage.peek('.obsidian/plugins/osint-copilot/data.json')).toBe(legacy);
    });

    it('also finds the BRAT install path', async () => {
        const { plugin } = await pluginFor({
            '.obsidian/plugins/Obsidian-OSINT-Copilot-plugin/data.json': JSON.stringify({ maxNotes: 7 }),
        });
        expect(await plugin.loadData()).toEqual({ maxNotes: 7 });
    });

    it('prefers its own settings over the legacy file', async () => {
        const { plugin } = await pluginFor({
            '.osint-copilot/data.json': JSON.stringify({ maxNotes: 1 }),
            '.obsidian/plugins/osint-copilot/data.json': JSON.stringify({ maxNotes: 99 }),
        });
        expect(await plugin.loadData()).toEqual({ maxNotes: 1 });
    });

    it('returns null for a vault that has never been used with either', async () => {
        const { plugin } = await pluginFor({});
        expect(await plugin.loadData()).toBeNull();
    });

    it('survives a corrupt legacy file rather than failing to launch', async () => {
        const { plugin } = await pluginFor({
            '.obsidian/plugins/osint-copilot/data.json': '{ not json',
        });
        expect(await plugin.loadData()).toBeNull();
    });
});
