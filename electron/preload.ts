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

function readPlatform(): PlatformInfo {
    const arg = process.argv.find((a) => a.startsWith(PLATFORM_FLAG));
    if (!arg) throw new Error('preload: platform snapshot missing from additionalArguments');
    return JSON.parse(arg.slice(PLATFORM_FLAG.length)) as PlatformInfo;
}

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
});
