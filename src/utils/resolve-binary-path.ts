/**
 * Resolves a configured CLI path/name to a real executable path, working around a common
 * Electron/GUI-launcher problem: the app's own process PATH is often missing the login shell's
 * additions (~/.local/bin, nvm/volta shims, Homebrew, curl-installer scripts, etc.), so a bare
 * `execFile(name, ...)` fails with ENOENT even though the binary is genuinely installed and a
 * normal terminal finds it fine. Obsidian is exactly this kind of GUI launcher, and this has
 * been observed in production for `pdftotext`, the `claude` CLI, and custom agent runtime CLIs.
 *
 * Resolution order (only for a *bare* command name -- a configured value containing a path
 * separator is trusted as-is, since the user has already told us exactly where it is):
 *  1. Extra candidate paths the caller knows about (e.g. `~/.claude/local/claude`), then a
 *     small set of common install-prefix bin directories.
 *  2. Every directory on the user's actual LOGIN shell PATH, found by spawning
 *     `$SHELL -ilc 'echo $PATH'` once per process and caching the result — this is what a real
 *     terminal session sees, so it covers install methods too varied to hardcode. Skipped on
 *     Windows, where this whole class of PATH mismatch is rare and there's no POSIX shell.
 *  3. The bare name, unchanged — so already-working setups (including Windows) are unaffected.
 *
 * Only a *successful* resolution (steps 1-2) is memoized. A fallback to the bare name means
 * "not found this time" -- caching that permanently would mean installing the CLI mid-session
 * and retrying with the same setting keeps failing until the app restarts, defeating the whole
 * point of auto-detection. A failed lookup is cheap enough to just redo (a handful of
 * existsSync calls; the expensive shell PATH probe is separately cached at the module level
 * regardless of which binary is being resolved -- a *failed* probe is still retried eventually,
 * bounded by a cooldown rather than either "forever" or "every call", see
 * FAILED_PROBE_RETRY_COOLDOWN_MS below).
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

/**
 * Windows has no single executable-extension convention for third-party install locations the
 * way this file's own defaultCandidatePaths below hardcodes (.exe for a Programs install, .cmd
 * for npm's global shim) -- npm-managed CLIs ship a `.cmd` shim, while volta and many installers
 * ship a native `.exe` shim instead. A caller building extra candidate paths from a raw binary
 * name (e.g. `~/.npm-global/bin/<name>`) would otherwise silently never match on Windows, which
 * is worse there than on Unix: the login-shell PATH probe below is Unix-only, so on Windows these
 * extra candidates plus defaultCandidatePaths are the *only* resolution mechanism.
 */
export function platformExecutableCandidates(basePath: string): string[] {
    if (process.platform !== 'win32') return [basePath];
    return [`${basePath}.cmd`, `${basePath}.exe`, basePath];
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

/**
 * Builds a consistent "CLI not found" error message for any provider using resolveCliPath,
 * naming the exact path that was tried and the Settings field to fix it from. Shared so wording
 * (e.g. the Windows `where` vs `which` hint) can't drift between providers.
 *
 * `configuredValue` containing a path separator means resolveCliPath returned it unchanged
 * without searching anything (see its module doc) -- the message must not then claim common
 * install locations and the shell PATH were tried, since they weren't.
 */
export function buildCliNotFoundMessage(displayName: string, triedPath: string, configuredValue: string, settingLabel: string): string {
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';
    const wasExplicitPath = configuredValue.includes('/') || configuredValue.includes('\\');
    const searchDescription = wasExplicitPath
        ? `tried "${triedPath}", the exact path configured`
        : `tried "${triedPath}", including common install locations and your shell PATH`;
    return (
        `${displayName} CLI not found (${searchDescription}). If it's installed, set "${settingLabel}" ` +
        `in Settings to its full path (run '${whichCommand} ${configuredValue}' in your terminal to find it).`
    );
}
