/**
 * Preload -- the entire trusted boundary between renderer and main.
 *
 * Runs with sandbox: true, so only `require('electron')` (plus events/timers/url)
 * is available: there is deliberately no fs/child_process/process access to hand
 * out even by mistake. Everything here is a forwarder; no logic lives in this file.
 *
 * `platform` is delivered synchronously via additionalArguments rather than IPC.
 * The renderer needs process.platform/homedir at 7+ call sites inside synchronous
 * candidate-path builders, and ipcRenderer.sendSync would block the renderer on a
 * main round-trip (and re-enter main's event loop) at every one.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ExecOptions, HttpRequest, PlatformInfo } from '../src/host/types';

const PLATFORM_FLAG = '--host-platform=';
const VAULT_FLAG = '--vault=';

function readPlatform(): PlatformInfo {
    const arg = process.argv.find((a) => a.startsWith(PLATFORM_FLAG));
    if (!arg) throw new Error('preload: platform snapshot missing from additionalArguments');
    return JSON.parse(arg.slice(PLATFORM_FLAG.length)) as PlatformInfo;
}

const forcedVault = process.argv.find((a) => a.startsWith(VAULT_FLAG))?.slice(VAULT_FLAG.length);
if (forcedVault) contextBridge.exposeInMainWorld('__vaultArg', forcedVault);

contextBridge.exposeInMainWorld('host', {
    platform: readPlatform(),
    env: {
        get: (name: string) => ipcRenderer.invoke('host:env.get', name),
    },
    cli: {
        resolve: (configured: string | undefined, fallback: string, extras?: string[], timeout?: number) =>
            ipcRenderer.invoke('host:cli.resolve', configured, fallback, extras, timeout),
        exec: (execId: string, binary: string, args: string[], options?: ExecOptions) =>
            ipcRenderer.invoke('host:cli.exec', execId, binary, args, options),
        kill: (execId: string) => ipcRenderer.send('host:cli.kill', execId),
    },
    net: {
        request: (request: HttpRequest) => ipcRenderer.invoke('host:net.request', request),
    },
    extract: {
        pdfText: (data: ArrayBuffer) => ipcRenderer.invoke('host:extract.pdfText', data),
        docxText: (data: ArrayBuffer) => ipcRenderer.invoke('host:extract.docxText', data),
    },
    vault: {
        open: (dir: string) => ipcRenderer.invoke('host:vault.open', dir),
        basePath: () => basePath,
        read: (p: string) => ipcRenderer.invoke('host:vault.read', p),
        readBinary: (p: string) => ipcRenderer.invoke('host:vault.readBinary', p),
        write: (p: string, d: string) => ipcRenderer.invoke('host:vault.write', p, d),
        writeBinary: (p: string, d: Uint8Array) => ipcRenderer.invoke('host:vault.writeBinary', p, d),
        create: (p: string, d: string) => ipcRenderer.invoke('host:vault.create', p, d),
        mkdir: (p: string) => ipcRenderer.invoke('host:vault.mkdir', p),
        remove: (p: string) => ipcRenderer.invoke('host:vault.remove', p),
        trash: (p: string) => ipcRenderer.invoke('host:vault.trash', p),
        rename: (from: string, to: string) => ipcRenderer.invoke('host:vault.rename', from, to),
        stat: (p: string) => ipcRenderer.invoke('host:vault.stat', p),
        onChange: (cb: (events: unknown[]) => void) => {
            const listener = (_e: unknown, events: unknown[]) => cb(events);
            ipcRenderer.on('host:vault.changed', listener);
            return () => ipcRenderer.off('host:vault.changed', listener);
        },
        resourceUrl: (p: string) => `osint-vault://${encodeURI(p)}`,
    },
    app: {
        pickVault: () => ipcRenderer.invoke('host:app.pickVault'),
        lastVault: () => ipcRenderer.invoke('host:app.lastVault'),
        rememberVault: (dir: string) => ipcRenderer.invoke('host:app.rememberVault', dir),
    },
});

/**
 * basePath must be synchronous (it is passed as the CLI cwd from synchronous code),
 * so main sends it down on every vault open rather than exposing an async getter.
 */
let basePath = '';
ipcRenderer.on('host:vault.basePath', (_e, value: string) => { basePath = value; });
