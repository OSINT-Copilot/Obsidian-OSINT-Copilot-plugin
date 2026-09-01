import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Vault } from '../src/obsidian-shim/vault/vault';
import { MemoryStorage } from '../src/obsidian-shim/vault/storage';
import { TFile, TFolder } from '../src/obsidian-shim/vault/tfile';
import type { WatchEvent } from '../src/host/types';

async function openVault(seed: Record<string, string> = {}) {
    const storage = new MemoryStorage();
    for (const [path, data] of Object.entries(seed)) await storage.write(path, data);
    const vault = new Vault(storage);
    await vault.open();
    return { vault, storage };
}

describe('Vault: lookup contract', () => {
    it('never throws, and returns null on a miss', async () => {
        const { vault } = await openVault();
        expect(vault.getAbstractFileByPath('nope.md')).toBeNull();
        expect(vault.getAbstractFileByPath('../escape')).toBeNull();
        expect(() => vault.getAbstractFileByPath('')).not.toThrow();
    });

    it('resolves "" and "/" to the root folder', async () => {
        const { vault } = await openVault();
        expect(vault.getAbstractFileByPath('')).toBe(vault.root);
        expect(vault.getAbstractFileByPath('/')).toBe(vault.root);
    });

    it('builds a tree with working instanceof and parent/child wiring', async () => {
        const { vault } = await openVault({ 'a/b/note.md': '# hi' });
        const file = vault.getAbstractFileByPath('a/b/note.md');
        expect(file).toBeInstanceOf(TFile);
        expect((file as TFile).extension).toBe('md');
        expect((file as TFile).basename).toBe('note');

        const folder = vault.getAbstractFileByPath('a/b');
        expect(folder).toBeInstanceOf(TFolder);
        expect((folder as TFolder).children).toContain(file);
        expect(file!.parent).toBe(folder);
    });

    it('normalizes lookups, so an NFD path finds an NFC-indexed file', async () => {
        const { vault } = await openVault({ 'Müller.md': 'x' });
        expect(vault.getAbstractFileByPath('Müller.md'.normalize('NFD'))).not.toBeNull();
    });
});

describe('Vault: Obsidian error contract', () => {
    it('createFolder creates intermediates but throws on an existing target', async () => {
        const { vault } = await openVault();
        // Recursive: EntityManager calls this on OSINTCopilot/ftm/Company with no ftm/.
        await vault.createFolder('OSINTCopilot/ftm/Company');
        expect(vault.getAbstractFileByPath('OSINTCopilot/ftm')).toBeInstanceOf(TFolder);

        // The substring is matched by vault-bootstrap-fs.ts:3.
        await expect(vault.createFolder('OSINTCopilot/ftm/Company')).rejects.toThrow(/already exists/);
    });

    it('create throws "File already exists." on a duplicate', async () => {
        const { vault } = await openVault();
        await vault.create('a.md', 'x');
        await expect(vault.create('a.md', 'y')).rejects.toThrow(/already exists/);
    });
});

describe('Vault: events fire synchronously from the mutating call', () => {
    it('emits create/modify/delete in order, before any watcher notification', async () => {
        const { vault } = await openVault();
        const seen: string[] = [];
        vault.on('create', (f) => seen.push(`create:${f.path}`));
        vault.on('modify', (f) => seen.push(`modify:${f.path}`));
        vault.on('delete', (f) => seen.push(`delete:${f.path}`));

        const file = await vault.create('a.md', 'one');
        await vault.modify(file, 'two');
        await vault.delete(file);

        expect(seen).toEqual(['create:a.md', 'modify:a.md', 'delete:a.md']);
    });

    it('offref stops delivery', async () => {
        const { vault } = await openVault();
        const handler = vi.fn();
        const ref = vault.on('create', handler);
        vault.offref(ref);
        await vault.create('a.md', 'x');
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('Vault: index coherence', () => {
    it('a Vault write and an equivalent out-of-band change produce identical index state', async () => {
        // (a) through the Vault API
        const viaApi = await openVault();
        await viaApi.vault.createFolder('docs');
        await viaApi.vault.create('docs/note.md', 'hello');

        // (b) written behind the Vault's back, then announced by the watcher
        const viaWatcher = await openVault();
        let emit: ((events: WatchEvent[]) => void) | null = null;
        const storage = new MemoryStorage();
        const vault = new Vault({
            snapshot: () => storage.snapshot(),
            read: (p) => storage.read(p),
            write: (p, d) => storage.write(p, d),
            create: (p, d) => storage.create(p, d),
            mkdir: (p) => storage.mkdir(p),
            remove: (p) => storage.remove(p),
            trash: (p) => storage.trash(p),
            rename: (f, t) => storage.rename(f, t),
            basePath: () => storage.basePath(),
            onChange: (cb) => { emit = cb; return () => { emit = null; }; },
        });
        await vault.open();
        const folderStat = await storage.mkdir('docs');
        const fileStat = await storage.write('docs/note.md', 'hello');
        emit!([
            { kind: 'create', path: 'docs', stat: folderStat },
            { kind: 'create', path: 'docs/note.md', stat: fileStat },
        ]);

        const shape = (v: Vault) => v.getAllLoadedFiles()
            .map((f) => `${f instanceof TFile ? 'file' : 'folder'}:${f.path}`).sort();

        expect(shape(vault)).toEqual(shape(viaApi.vault));
        expect(viaWatcher.vault.getMarkdownFiles()).toHaveLength(0); // untouched control
    });

    it('rename reindexes the whole subtree', async () => {
        const { vault } = await openVault({ 'old/a.md': '1', 'old/deep/b.md': '2' });
        await vault.rename(vault.getAbstractFileByPath('old')!, 'new');

        expect(vault.getAbstractFileByPath('old')).toBeNull();
        expect(vault.getAbstractFileByPath('old/deep/b.md')).toBeNull();
        expect(vault.getAbstractFileByPath('new/deep/b.md')).toBeInstanceOf(TFile);
        expect(vault.getAbstractFileByPath('new/a.md')!.parent!.path).toBe('new');
    });

    it('deleting a folder removes its descendants from the index', async () => {
        const { vault } = await openVault({ 'x/y/z.md': '1' });
        await vault.delete(vault.getAbstractFileByPath('x')!);
        expect(vault.getAbstractFileByPath('x/y/z.md')).toBeNull();
        expect(vault.getFiles()).toHaveLength(0);
    });
});

describe('Vault: cachedRead', () => {
    it('serves repeat reads without hitting storage, and reloads after a modify', async () => {
        const { vault, storage } = await openVault({ 'a.md': 'one' });
        const spy = vi.spyOn(storage, 'read');
        const file = vault.getAbstractFileByPath('a.md') as TFile;

        expect(await vault.cachedRead(file)).toBe('one');
        expect(await vault.cachedRead(file)).toBe('one');
        // orchestration-service reads every markdown file per turn; without this each
        // read would be an IPC round-trip.
        expect(spy).toHaveBeenCalledTimes(1);

        await vault.modify(file, 'two');
        expect(await vault.cachedRead(file)).toBe('two');
    });
});

describe('Vault: adapter surface', () => {
    it('supports the calls conversation-service makes', async () => {
        const { vault } = await openVault();
        expect(await vault.adapter.exists('conv/a.md')).toBe(false);
        await vault.adapter.write('conv/a.md', 'hello');
        expect(await vault.adapter.exists('conv/a.md')).toBe(true);
        expect(await vault.adapter.read('conv/a.md')).toBe('hello');

        await vault.adapter.write('conv/a.md', 'updated');
        expect(await vault.adapter.read('conv/a.md')).toBe('updated');

        expect((await vault.adapter.list('conv')).files).toEqual(['conv/a.md']);
        expect((await vault.adapter.stat('conv/a.md'))?.type).toBe('file');

        await vault.adapter.remove('conv/a.md');
        expect(await vault.adapter.exists('conv/a.md')).toBe(false);
    });
});
