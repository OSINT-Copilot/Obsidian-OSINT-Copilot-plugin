/**
 * Renderer implementation of the host contract: a thin forwarder to window.host,
 * which preload exposes over IPC. There is deliberately no fallback -- if the
 * bridge is missing, that is a wiring bug and should fail loudly rather than
 * silently degrade.
 */
import type { Host } from './types';

declare global {
    interface Window { host?: Host }
}

function bridge(): Host {
    const injected = globalThis.window?.host;
    if (!injected) {
        throw new Error('host bridge unavailable: preload did not run, or contextBridge failed');
    }
    return injected;
}

export const host: Host = {
    get platform() { return bridge().platform; },
    env: { get: (name) => bridge().env.get(name) },
    cli: {
        resolve: (configured, fallback, extras, timeout) => bridge().cli.resolve(configured, fallback, extras, timeout),
        exec: (execId, binary, args, options) => bridge().cli.exec(execId, binary, args, options),
        kill: (execId) => bridge().cli.kill(execId),
    },
    net: { request: (req) => bridge().net.request(req) },
    extract: {
        pdfText: (data) => bridge().extract.pdfText(data),
        docxText: (data) => bridge().extract.docxText(data),
    },
};
