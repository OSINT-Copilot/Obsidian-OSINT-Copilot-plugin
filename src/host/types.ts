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

export interface StatDto {
    path: string;
    type: 'file' | 'folder';
    ctime: number;
    mtime: number;
    size: number;
}

export type WatchEventKind = 'create' | 'modify' | 'delete' | 'rename';

export interface WatchEvent {
    kind: WatchEventKind;
    /** Always NFC-normalised in main before it is sent, so index keys always match. */
    path: string;
    oldPath?: string;
    stat?: StatDto;
}

export interface VaultHost {
    /** Opens a folder as the vault and returns its complete tree in one call. */
    open(dir: string): Promise<StatDto[]>;
    /** Absolute path of the open vault -- used as CLI cwd. */
    basePath(): string;
    read(path: string): Promise<string>;
    readBinary(path: string): Promise<Uint8Array>;
    /** Overwrites. Returns the authoritative post-write stat so the index cannot drift. */
    write(path: string, data: string): Promise<StatDto>;
    writeBinary(path: string, data: Uint8Array): Promise<StatDto>;
    /** Throws Error("File already exists.") when path exists -- vault-bootstrap-fs matches on it. */
    create(path: string, data: string): Promise<StatDto>;
    /**
     * Creates intermediate folders, but throws Error("Folder already exists.") when the
     * TARGET exists. Both halves are load-bearing; see the Phase 0 finding.
     */
    mkdir(path: string): Promise<StatDto>;
    remove(path: string): Promise<void>;
    /** Moves to the OS trash rather than unlinking (fileManager.trashFile). */
    trash(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    stat(path: string): Promise<StatDto | null>;
    /** Batched watcher events for out-of-band edits; self-writes are suppressed in main. */
    onChange(callback: (events: WatchEvent[]) => void): () => void;
    /** Custom-protocol URL for displaying a vault file (images on graph nodes). */
    resourceUrl(path: string): string;
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

    vault: VaultHost;

    app: {
        /** Native folder picker. Returns null if the user cancels. */
        pickVault(): Promise<string | null>;
        /** Last opened vault, remembered across launches in userData. */
        lastVault(): Promise<string | null>;
        rememberVault(dir: string): Promise<void>;
    };
}
