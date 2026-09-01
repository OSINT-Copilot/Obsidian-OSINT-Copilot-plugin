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
    vault: {
        open: (dir) => bridge().vault.open(dir),
        basePath: () => bridge().vault.basePath(),
        read: (p) => bridge().vault.read(p),
        readBinary: (p) => bridge().vault.readBinary(p),
        write: (p, data) => bridge().vault.write(p, data),
        writeBinary: (p, data) => bridge().vault.writeBinary(p, data),
        create: (p, data) => bridge().vault.create(p, data),
        mkdir: (p) => bridge().vault.mkdir(p),
        remove: (p) => bridge().vault.remove(p),
        trash: (p) => bridge().vault.trash(p),
        rename: (from, to) => bridge().vault.rename(from, to),
        stat: (p) => bridge().vault.stat(p),
        onChange: (cb) => bridge().vault.onChange(cb),
        resourceUrl: (p) => bridge().vault.resourceUrl(p),
    },
};
