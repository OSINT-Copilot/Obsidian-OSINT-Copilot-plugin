/**
 * CLI path resolution engine -- runs in Node (Electron main process, and vitest).
 *
 * Moved verbatim out of src/utils/resolve-binary-path.ts when the renderer was
 * sandboxed; that file is now a thin delegate to host.cli.resolve. The logic and
 * its rationale are unchanged, including the login-shell PATH probe, which is if
 * anything MORE necessary here: an Electron app launched from Finder or a .desktop
 * entry has exactly the same truncated-PATH problem Obsidian did.
 *
 * process.platform is read dynamically rather than snapshotted because the existing
 * suite overrides it with Object.defineProperty to exercise the win32 branches.
 */

let loginShellPathDirsPromise: Promise<string[]> | null = null;
let loginShellPathDirsFailedAt: number | null = null;
/**
 * Bounds how long a failed shell PATH probe stays cached. Neither extreme works: caching a
 * failure forever means "install the CLI mid-session and retry" keeps failing until the app
 * restarts (the original bug); never caching a failure means a durably broken shell probe (no
 * usable $SHELL, a sandboxed/non-interactive Electron environment, a shell startup script that
 * always breaks the marker parse) re-pays the full multi-second probe timeout on *every single*
 * resolveCliPath call for an unresolved binary -- every CLI invocation, health check, and the
 * periodic runtime-availability poll. A cooldown bounds the retry-storm risk while still
 * recovering well within a normal troubleshooting session.
 */
const FAILED_PROBE_RETRY_COOLDOWN_MS = 5 * 60_000;

function getLoginShellPathDirs(timeoutMs: number): Promise<string[]> {
    const cooledDown = loginShellPathDirsFailedAt !== null
        && Date.now() - loginShellPathDirsFailedAt >= FAILED_PROBE_RETRY_COOLDOWN_MS;
    if (loginShellPathDirsPromise && !cooledDown) return loginShellPathDirsPromise;

    const probe: Promise<string[]> = new Promise((resolve) => {
        if (process.platform === 'win32') {
            resolve([]);
            return;
        }
        try {
            const { execFile } = require('child_process') as typeof import('child_process');
            const path = require('path') as typeof import('path');
            const shell = process.env.SHELL || '/bin/bash';
            // -ilc (interactive login) is needed to pick up PATH customizations that shell rc
            // files often only apply for interactive sessions (nvm, volta, etc.), but that same
            // interactivity means startup scripts can print a banner/MOTD to stdout ahead of our
            // output. Bracket the PATH in unique markers and extract only what's between them,
            // so banner text before/after can't get parsed as (or corrupt) real PATH entries.
            const startMarker = '===OSINT_COPILOT_PATH_START===';
            const endMarker = '===OSINT_COPILOT_PATH_END===';
            execFile(shell, ['-ilc', `echo "${startMarker}$PATH${endMarker}"`], { timeout: timeoutMs }, (error: unknown, stdout: string) => {
                if (error || !stdout) {
                    resolve([]);
                    return;
                }
                const match = stdout.match(new RegExp(`${startMarker}([\\s\\S]*?)${endMarker}`));
                if (!match) {
                    resolve([]);
                    return;
                }
                resolve(match[1].trim().split(path.delimiter).filter(Boolean));
            });
        } catch {
            resolve([]);
        }
    });
    loginShellPathDirsPromise = probe;
    loginShellPathDirsFailedAt = null;
    // win32's deliberate, immediate `resolve([])` is not a failure -- it's cached forever like any
    // other successful probe (and is free to repeat regardless, since it never reaches execFile).
    probe.then((dirs) => {
        if (dirs.length === 0 && process.platform !== 'win32') loginShellPathDirsFailedAt = Date.now();
    });
    return probe;
}

/** Common install-prefix bin directories, checked before the (more expensive) shell PATH probe. */
function defaultCandidatePaths(binaryName: string): string[] {
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const home = os.homedir();
    if (process.platform === 'win32') {
        return [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', binaryName, `${binaryName}.exe`),
            path.join(process.env.APPDATA || '', 'npm', `${binaryName}.cmd`),
        ];
    }
    return [
        path.join(home, '.local/bin', binaryName),
        '/usr/local/bin/' + binaryName,
        '/opt/homebrew/bin/' + binaryName,
        '/usr/bin/' + binaryName,
    ];
}

/**
 * existsSync alone would also match a stale leftover directory or broken artifact at a candidate
 * path, stopping the search before reaching a working install further down the order (e.g. on
 * the real login-shell PATH). statSync follows symlinks (common for version-managed installs,
 * e.g. ~/.local/bin/claude -> versions/2.1.236), so a symlinked real binary still matches. A
 * regular-file match that isn't actually executable (e.g. a stray non-executable file left behind
 * by a broken install) must also be rejected -- a *successful* resolution gets cached forever
 * (see resolveCliPath), so matching it here would permanently wire a broken path in and hide any
 * real install further down the search order. Windows has no POSIX exec bit -- executability
 * there is governed by file extension, which the .exe/.cmd candidate names already encode.
 */
function isExecutableFile(fs: typeof import('fs'), candidate: string): boolean {
    try {
        if (!fs.statSync(candidate).isFile()) return false;
        if (process.platform === 'win32') return true;
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

async function resolveExistingPath(binaryName: string, extraCandidates: string[], probeTimeoutMs: number): Promise<string> {
    const fs = require('fs') as typeof import('fs');
    const candidates = [...extraCandidates, ...defaultCandidatePaths(binaryName)];
    for (const candidate of candidates) {
        if (candidate && isExecutableFile(fs, candidate)) return candidate;
    }

    try {
        const path = require('path') as typeof import('path');
        const dirs = await getLoginShellPathDirs(probeTimeoutMs);
        for (const dir of dirs) {
            const full = path.join(dir, binaryName);
            if (isExecutableFile(fs, full)) return full;
        }
    } catch { /* fall through to bare name */ }

    return binaryName;
}

const resolvedPathCache = new Map<string, string>();

/**
 * Resolves a user-configured CLI path/name. `configuredValue` containing a path separator is
 * returned as-is (explicit user configuration always wins); an empty value falls back to
 * `fallbackBareName`; otherwise the bare name is auto-detected per the module doc above.
 */
export async function resolveCliPath(
    configuredValue: string | undefined,
    fallbackBareName: string,
    extraCandidates: string[] = [],
    probeTimeoutMs = 5000,
): Promise<string> {
    const configured = configuredValue?.trim() || fallbackBareName;
    if (configured.includes('/') || configured.includes('\\')) return configured;

    const cacheKey = `${configured} ${extraCandidates.join(' ')}`;
    const cached = resolvedPathCache.get(cacheKey);
    if (cached) return cached;

    const resolved = await resolveExistingPath(configured, extraCandidates, probeTimeoutMs);
    if (resolved !== configured) resolvedPathCache.set(cacheKey, resolved);
    return resolved;
}

