/**
 * Node implementation of the host contract.
 *
 * Used by the Electron main process and by vitest. The sandboxed renderer never
 * links this file -- esbuild aliases ./impl to ./impl.bridge for that target.
 */
import type { ExecOptions, ExecResult, Host, HttpRequest, HttpResponse, PlatformInfo } from './types';
import { resolveCliPath } from './node/cli';
import * as vaultFs from './node/vault';
import * as secretStore from './node/secrets';
import { assertRequestAllowed } from './node/net-guard';

/**
 * Getters, not a snapshot: the resolve-binary-path suite overrides process.platform
 * with Object.defineProperty to exercise win32 branches, and a snapshot taken at
 * import time would defeat that.
 */
const platform: PlatformInfo = {
    get os() { return process.platform; },
    get arch() { return process.arch; },
    get homedir() { return (require('os') as typeof import('os')).homedir(); },
    get pathSep() { return (require('path') as typeof import('path')).sep; },
    get pathDelimiter() { return (require('path') as typeof import('path')).delimiter; },
    get isFlatpak() { return process.platform === 'linux' && Boolean(process.env.FLATPAK_ID?.trim()); },
    get electron() { return process.versions.electron ?? ''; },
    get chrome() { return process.versions.chrome ?? ''; },
};

const running = new Map<string, import('child_process').ChildProcess>();

async function exec(execId: string, binary: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const { execFile } = require('child_process') as typeof import('child_process');

    return new Promise<ExecResult>((resolve) => {
        const child = execFile(
            binary,
            args,
            {
                cwd: options.cwd,
                timeout: options.timeoutMs,
                maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
                env: { ...process.env, ...(options.envOverrides ?? {}) },
            },
            (error, stdout, stderr) => {
                running.delete(execId);
                // ExecFileException.code is string | number | null (an errno like 'ENOENT'
                // for spawn failures, an exit status for a process that ran and failed).
                resolve({
                    stdout: String(stdout ?? ''),
                    stderr: String(stderr ?? ''),
                    code: error?.code ?? (error ? 1 : 0),
                    signal: error?.signal ?? null,
                    killed: Boolean(error?.killed),
                    errorMessage: error?.message,
                });
            },
        );

        running.set(execId, child);

        if (options.stdin !== undefined && child.stdin) {
            // An unhandled EPIPE here crashed the Obsidian renderer; keep the guard.
            child.stdin.on('error', () => { /* ignore EPIPE */ });
            child.stdin.write(options.stdin);
            child.stdin.end();
        }
    });
}

async function request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url);
    const headers: Record<string, string> = {
        ...(req.contentType ? { 'Content-Type': req.contentType } : {}),
        ...(req.headers ?? {}),
    };

    // Secrets are resolved and injected HERE, never in the renderer.
    if (req.auth) {
        const secret = await secretStore.resolveSecret(req.auth.ref);
        if (!secret) {
            throw new Error(
                `Missing credential (${req.auth.ref.source}: ${req.auth.ref.name})`,
            );
        }
        if (req.auth.placement === 'bearer') {
            headers.Authorization = `Bearer ${secret}`;
        } else if (req.auth.placement === 'header') {
            headers[req.auth.headerName || 'X-API-Key'] = secret;
        } else {
            url.searchParams.set(req.auth.queryParam || 'api_key', secret);
        }
    }

    // Allowlist + private-address denial, after any auth rewrote the URL.
    await assertRequestAllowed(url.toString(), req.allowedDomains);

    const response = await fetch(url.toString(), {
        method: req.method ?? 'GET',
        headers,
        body: req.body as BodyInit | undefined,
    });

    const arrayBuffer = await response.arrayBuffer();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { responseHeaders[key.toLowerCase()] = value; });

    if (req.throw !== false && response.status >= 400) {
        throw Object.assign(new Error(`Request failed, status ${response.status}`), { status: response.status });
    }

    return {
        status: response.status,
        headers: responseHeaders,
        arrayBuffer,
        text: new TextDecoder().decode(arrayBuffer),
    };
}

export const host: Host = {
    platform,
    secrets: {
        has: secretStore.hasSecret,
        setKeychain: secretStore.setKeychain,
        deleteKeychain: secretStore.deleteKeychain,
        listKeychain: secretStore.listKeychain,
    },
    cli: {
        resolve: resolveCliPath,
        exec,
        kill(execId: string) { running.get(execId)?.kill('SIGTERM'); },
    },
    net: { request },
    vault: {
        open: vaultFs.open,
        basePath: vaultFs.basePath,
        read: vaultFs.read,
        readBinary: vaultFs.readBinary,
        write: vaultFs.write,
        writeBinary: vaultFs.writeBinary,
        create: vaultFs.create,
        mkdir: vaultFs.mkdir,
        remove: vaultFs.remove,
        // Electron's shell.trashItem is only available in main; under vitest this
        // degrades to a plain remove, which is what the tests want anyway.
        trash: vaultFs.remove,
        rename: vaultFs.rename,
        stat: vaultFs.stat,
        onChange: vaultFs.onChange,
        resourceUrl: (path: string) => `osint-vault://${encodeURI(path)}`,
    },
    // Overridden in main (electron/ipc) where dialog and userData exist; inert under vitest.
    app: {
        async pickVault() { return null; },
        async lastVault() { return null; },
        async rememberVault() { /* no-op outside Electron */ },
    },
    extract: {
        async pdfText(data: ArrayBuffer) {
            const { extractPdfText } = await import('./node/extract');
            return extractPdfText(data);
        },
        async docxText(data: ArrayBuffer) {
            const { extractDocxText } = await import('./node/extract');
            return extractDocxText(data);
        },
    },
};
