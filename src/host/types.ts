/**
 * The host contract -- the complete boundary between renderer code and the OS.
 *
 * Two implementations satisfy it:
 *   impl.ts        Node. Used by the Electron main process and by vitest.
 *   impl.bridge.ts Renderer. Forwards to window.host, which preload exposes over IPC.
 *
 * esbuild's renderer target aliases ./impl -> ./impl.bridge, so a sandboxed
 * renderer never links the Node implementation. Everything else (tests included)
 * gets the Node one, which is why the existing suites keep passing untouched.
 */

export interface PlatformInfo {
    /** NodeJS.Platform: 'darwin' | 'linux' | 'win32' | ... */
    readonly os: string;
    readonly arch: string;
    readonly homedir: string;
    readonly pathSep: string;
    readonly pathDelimiter: string;
    readonly isFlatpak: boolean;
    /** Empty outside Electron (e.g. under vitest). */
    readonly electron: string;
    readonly chrome: string;
}

export interface ExecOptions {
    cwd?: string;
    stdin?: string;
    timeoutMs?: number;
    maxBuffer?: number;
    /** Allowlisted names only; main merges real process.env itself. */
    envOverrides?: Record<string, string>;
}

export interface ExecResult {
    stdout: string;
    stderr: string;
    /**
     * Node's ExecFileException.code verbatim: an errno string ('ENOENT') when the
     * spawn itself failed, or a numeric exit status when the process ran and failed.
     * Callers classify on 'ENOENT' to distinguish "CLI not installed" from "CLI
     * errored", so this must not be normalised to a number.
     */
    code: string | number | null;
    signal: string | null;
    killed: boolean;
    /** Present iff execFile reported an error. */
    errorMessage?: string;
}

export interface HttpRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    contentType?: string;
    /** false => non-2xx resolves normally (wayback, enrichers rely on this). */
    throw?: boolean;
}

export interface HttpResponse {
    status: number;
    /** Keys are lowercased: api-service reads headers['content-type']. */
    headers: Record<string, string>;
    arrayBuffer: ArrayBuffer;
    text: string;
}

export interface Host {
    /**
     * Synchronous because process.platform (7 sites) and os.homedir() never change
     * during a run. Delivering them as a snapshot is what keeps the candidate-path
     * builders synchronous and stops the sandbox conversion rippling through
     * resolve-binary-path's call graph.
     */
    readonly platform: PlatformInfo;

    env: {
        /** One key per call -- never the whole environment. */
        get(name: string): Promise<string | null>;
    };

    cli: {
        resolve(configured: string | undefined, fallbackBareName: string, extraCandidates?: string[], probeTimeoutMs?: number): Promise<string>;
        /**
         * `execId` is supplied by the caller rather than returned, so an AbortSignal
         * handler can call kill() for a process whose exec promise has not settled.
         */
        exec(execId: string, binary: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
        kill(execId: string): void;
    };

    net: {
        request(request: HttpRequest): Promise<HttpResponse>;
    };

    extract: {
        pdfText(data: ArrayBuffer): Promise<string>;
        docxText(data: ArrayBuffer): Promise<string>;
    };
}
