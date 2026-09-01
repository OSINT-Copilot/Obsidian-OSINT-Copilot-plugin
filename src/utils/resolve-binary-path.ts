/**
 * Renderer-facing CLI path resolution.
 *
 * The resolution engine itself -- login-shell PATH probe, candidate scanning,
 * executability checks, caching -- moved to src/host/node/cli.ts when the renderer
 * was sandboxed, since it needs child_process/fs/os. This file keeps the public
 * API unchanged (resolveCliPath was already async and every caller already awaited
 * it, so no signature moved) and delegates across the host boundary.
 *
 * The two synchronous helpers stay here: both need only the platform string, which
 * the host snapshot provides without an IPC round-trip.
 */
import { host } from '../host';

/**
 * Windows has no single executable-extension convention for third-party install locations the
 * way the engine's defaultCandidatePaths hardcodes (.exe for a Programs install, .cmd for npm's
 * global shim) -- npm-managed CLIs ship a `.cmd` shim, while volta and many installers ship a
 * native `.exe` shim instead. A caller building extra candidate paths from a raw binary name
 * (e.g. `~/.npm-global/bin/<name>`) would otherwise silently never match on Windows, which is
 * worse there than on Unix: the login-shell PATH probe is Unix-only, so on Windows these extra
 * candidates plus defaultCandidatePaths are the *only* resolution mechanism.
 */
export function platformExecutableCandidates(basePath: string): string[] {
    if (host.platform.os !== 'win32') return [basePath];
    return [`${basePath}.cmd`, `${basePath}.exe`, basePath];
}

/**
 * Resolves a user-configured CLI path/name. A `configuredValue` containing a path separator is
 * returned as-is (explicit user configuration always wins); an empty value falls back to
 * `fallbackBareName`; otherwise the bare name is auto-detected.
 */
export function resolveCliPath(
    configuredValue: string | undefined,
    fallbackBareName: string,
    extraCandidates: string[] = [],
    probeTimeoutMs = 5000,
): Promise<string> {
    return host.cli.resolve(configuredValue, fallbackBareName, extraCandidates, probeTimeoutMs);
}

/**
 * Builds a consistent "CLI not found" error message for any provider using resolveCliPath,
 * naming the exact path that was tried and the Settings field to fix it from. Shared so wording
 * (e.g. the Windows `where` vs `which` hint) can't drift between providers.
 *
 * `configuredValue` containing a path separator means resolveCliPath returned it unchanged
 * without searching anything -- the message must not then claim common install locations and
 * the shell PATH were tried, since they weren't.
 */
export function buildCliNotFoundMessage(displayName: string, triedPath: string, configuredValue: string, settingLabel: string): string {
    const whichCommand = host.platform.os === 'win32' ? 'where' : 'which';
    const wasExplicitPath = configuredValue.includes('/') || configuredValue.includes('\\');
    const searchDescription = wasExplicitPath
        ? `tried "${triedPath}", the exact path configured`
        : `tried "${triedPath}", including common install locations and your shell PATH`;
    return (
        `${displayName} CLI not found (${searchDescription}). If it's installed, set "${settingLabel}" ` +
        `in Settings to its full path (run '${whichCommand} ${configuredValue}' in your terminal to find it).`
    );
}
