/**
 * Main-process IPC handlers -- the privileged half of the host contract.
 *
 * Every handler delegates to the Node host implementation, so main and vitest run
 * exactly the same code. Validation that belongs to the trust boundary (path
 * confinement, binary allowlisting, SSRF denial) lands here in Phase 2/6; the
 * renderer is untrusted and none of it may be enforced on that side.
 */
import { ipcMain } from 'electron';
import { host } from '../../src/host/impl';
import type { ExecOptions, HttpRequest } from '../../src/host/types';

export function registerHostHandlers(): void {
    ipcMain.handle('host:env.get', (_e, name: string) => host.env.get(name));

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
