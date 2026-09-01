/**
 * Main-process IPC handlers -- the privileged half of the host contract.
 *
 * Every handler delegates to the Node host implementation, so main and vitest run
 * exactly the same code. Validation that belongs to the trust boundary (path
 * confinement, binary allowlisting, SSRF denial) lands here in Phase 2/6; the
 * renderer is untrusted and none of it may be enforced on that side.
 */
import { app as electronApp, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fsp from 'fs/promises';
import * as nodePath from 'path';
import { host } from '../../src/host/impl';
import * as vaultFs from '../../src/host/node/vault';
import type { ExecOptions, HttpRequest, SecretRef } from '../../src/host/types';

export function registerHostHandlers(): void {
    // Deliberately no 'host:secrets.get': there is no channel that returns a secret.
    ipcMain.handle('host:secrets.has', (_e, ref: SecretRef) => host.secrets.has(ref));
    ipcMain.handle('host:secrets.setKeychain', (_e, name: string, value: string) =>
        host.secrets.setKeychain(name, value));
    ipcMain.handle('host:secrets.deleteKeychain', (_e, name: string) => host.secrets.deleteKeychain(name));
    ipcMain.handle('host:secrets.listKeychain', () => host.secrets.listKeychain());

    ipcMain.handle('host:cli.resolve', (_e, configured: string | undefined, fallback: string, extras?: string[], timeout?: number) =>
        host.cli.resolve(configured, fallback, extras, timeout));

    ipcMain.handle('host:cli.exec', (_e, execId: string, binary: string, args: string[], options?: ExecOptions) =>
        host.cli.exec(execId, binary, args, options));

    ipcMain.on('host:cli.kill', (_e, execId: string) => host.cli.kill(execId));

    ipcMain.handle('host:net.request', async (_e, request: HttpRequest) => {
        const response = await host.net.request(request);
        // ArrayBuffer survives structured clone; text is already materialised because
        // every consumer reads .text/.json as a property, never as a method.
        return response;
    });

    ipcMain.handle('host:extract.pdfText', (_e, data: ArrayBuffer) => host.extract.pdfText(data));
    ipcMain.handle('host:extract.docxText', (_e, data: ArrayBuffer) => host.extract.docxText(data));

    // ---------------------------------------------------------------- vault fs
    ipcMain.handle('host:vault.open', async (event, dir: string) => {
        const snapshot = await vaultFs.open(dir);
        const contents = event.sender;
        // basePath must be readable synchronously in the renderer (it is the CLI cwd),
        // so it is pushed rather than fetched.
        contents.send('host:vault.basePath', vaultFs.basePath());
        vaultFs.onChange((events) => {
            if (!contents.isDestroyed()) contents.send('host:vault.changed', events);
        });
        return snapshot;
    });

    ipcMain.handle('host:vault.read', (_e, p: string) => vaultFs.read(p));
    ipcMain.handle('host:vault.readBinary', (_e, p: string) => vaultFs.readBinary(p));
    ipcMain.handle('host:vault.write', (_e, p: string, d: string) => vaultFs.write(p, d));
    ipcMain.handle('host:vault.writeBinary', (_e, p: string, d: Uint8Array) => vaultFs.writeBinary(p, d));
    ipcMain.handle('host:vault.create', (_e, p: string, d: string) => vaultFs.create(p, d));
    ipcMain.handle('host:vault.mkdir', (_e, p: string) => vaultFs.mkdir(p));
    ipcMain.handle('host:vault.remove', (_e, p: string) => vaultFs.remove(p));
    ipcMain.handle('host:vault.rename', (_e, from: string, to: string) => vaultFs.rename(from, to));
    ipcMain.handle('host:vault.stat', (_e, p: string) => vaultFs.stat(p));

    /** Real OS trash, not unlink -- 4 fileManager.trashFile call sites depend on it. */
    ipcMain.handle('host:vault.trash', async (_e, p: string) => {
        await shell.trashItem(vaultFs.absolutePathOf(p));
    });

    // -------------------------------------------------------------- app / vault choice
    ipcMain.handle('host:app.pickVault', async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const result = window
            ? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
            : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
        return result.canceled ? null : result.filePaths[0] ?? null;
    });

    ipcMain.handle('host:app.lastVault', async () => {
        try {
            const raw = await fsp.readFile(recentVaultFile(), 'utf-8');
            const dir = JSON.parse(raw).lastVault as string | undefined;
            if (!dir) return null;
            await fsp.access(dir);
            return dir;
        } catch {
            return null;
        }
    });

    ipcMain.handle('host:app.rememberVault', async (_e, dir: string) => {
        await fsp.mkdir(nodePath.dirname(recentVaultFile()), { recursive: true });
        await fsp.writeFile(recentVaultFile(), JSON.stringify({ lastVault: dir }, null, 2));
    });
}

/** App preferences live in userData, not the vault: they are about which vault to open. */
function recentVaultFile(): string {
    return nodePath.join(electronApp.getPath('userData'), 'recent-vault.json');
}

/** Serialised into webPreferences.additionalArguments so the renderer reads it synchronously. */
export function platformSnapshotArg(): string {
    const p = host.platform;
    return `--host-platform=${JSON.stringify({
        os: p.os, arch: p.arch, homedir: p.homedir, pathSep: p.pathSep,
        pathDelimiter: p.pathDelimiter, isFlatpak: p.isFlatpak,
        electron: p.electron, chrome: p.chrome,
    })}`;
}
