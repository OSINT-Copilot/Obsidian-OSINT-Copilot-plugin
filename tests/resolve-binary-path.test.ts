import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildCliNotFoundMessage, platformExecutableCandidates, resolveCliPath } from '../src/utils/resolve-binary-path';

// resolve-binary-path.ts uses `require('fs')`/`require('os')`/`require('child_process')` at
// runtime (matching this codebase's convention for Node builtins external to the esbuild
// bundle), which vi.mock's module interception does not reliably catch -- confirmed empirically
// while writing this suite (mocked existsSync was simply never invoked). These tests exercise
// real filesystem/process state instead, the same way tests/claude-code-service-logs.test.ts's
// EPIPE test spawns a real child process against process.execPath rather than mocking
// child_process.

let originalPlatform: PropertyDescriptor | undefined;
let originalShell: string | undefined;
let tempDir: string;

beforeEach(() => {
	originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
	originalShell = process.env.SHELL;
	tempDir = mkdtempSync(join(tmpdir(), 'resolve-binary-path-test-'));
});

afterEach(() => {
	if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
	if (originalShell === undefined) delete process.env.SHELL;
	else process.env.SHELL = originalShell;
	rmSync(tempDir, { recursive: true, force: true });
});

describe('resolveCliPath', () => {
	it('returns an explicit absolute path unchanged, without any resolution attempt', async () => {
		const result = await resolveCliPath('/opt/custom/mybin', 'mybin');
		expect(result).toBe('/opt/custom/mybin');
	});

	it('returns an explicit relative path unchanged (any path separator counts as explicit)', async () => {
		const result = await resolveCliPath('./local-tool', 'local-tool');
		expect(result).toBe('./local-tool');
	});

	it('falls back to fallbackBareName when configuredValue is empty or whitespace', async () => {
		const missingName = 'definitely-nonexistent-cli-abc123-empty';
		const resultUndefined = await resolveCliPath(undefined, missingName);
		const resultEmpty = await resolveCliPath('   ', missingName);
		// Neither is on any real install path or this machine's PATH, so both fall through to
		// the bare fallback name unchanged -- proving the empty/whitespace value was substituted.
		expect(resultUndefined).toBe(missingName);
		expect(resultEmpty).toBe(missingName);
	});

	it('finds a real file among caller-supplied extra candidates', async () => {
		const realBinary = join(tempDir, 'my-real-tool');
		writeFileSync(realBinary, '#!/bin/sh\necho hi\n');
		chmodSync(realBinary, 0o755);

		const result = await resolveCliPath('my-real-tool', 'my-real-tool', [realBinary]);
		expect(result).toBe(realBinary);
	});

	it('skips extra candidates that do not exist and keeps looking', async () => {
		const realBinary = join(tempDir, 'second-candidate-tool');
		writeFileSync(realBinary, '');
		chmodSync(realBinary, 0o755);
		const fakeBinary = join(tempDir, 'does-not-exist-tool');

		const result = await resolveCliPath('second-candidate-tool', 'second-candidate-tool', [fakeBinary, realBinary]);
		expect(result).toBe(realBinary);
	});

	it('skips a candidate that exists but is not executable, and keeps looking', async () => {
		if (process.platform === 'win32') return; // POSIX exec bit does not apply on Windows
		const notExecutable = join(tempDir, 'not-executable-tool');
		writeFileSync(notExecutable, '');
		chmodSync(notExecutable, 0o644);
		const executable = join(tempDir, 'actually-executable-tool');
		writeFileSync(executable, '#!/bin/sh\necho hi\n');
		chmodSync(executable, 0o755);

		// A non-executable match must not win (and, since only a *successful* resolution is
		// cached forever, must not get permanently wired in ahead of the real, working install).
		const result = await resolveCliPath('some-tool', 'some-tool', [notExecutable, executable]);
		expect(result).toBe(executable);
	});

	it('returns the bare name unchanged when it cannot be found anywhere', async () => {
		const missingName = 'definitely-nonexistent-cli-xyz789-nowhere';
		const result = await resolveCliPath(missingName, missingName);
		expect(result).toBe(missingName);
	});

	it('resolves a binary genuinely on this machine (node itself) via the login shell PATH probe', async () => {
		// A real, guaranteed-resolvable name that is virtually never sitting in one of the fixed
		// default candidate directories on a dev/CI machine (it's usually under nvm/volta/asdf/a
		// version manager shim, or wherever the current Node install lives) -- exercising this
		// exact case is the whole point of the shell PATH probe fallback. Skipped gracefully if
		// this environment's node isn't actually reachable via a login shell for some reason
		// (e.g. a minimal container with no profile), since that's an environment limitation, not
		// a behavior this function should be expected to overcome.
		const result = await resolveCliPath('node', 'node');
		if (result === 'node') return; // environment couldn't shell-probe; nothing to assert
		expect(result.endsWith('/node')).toBe(true);
	});

	it('never attempts a shell PATH probe on win32 (falls straight to the bare name)', async () => {
		// A fresh module instance is required here: the module-level login-shell-PATH cache
		// (populated by the earlier "login shell PATH probe" test) would otherwise carry over.
		// A genuinely fake binary name would pass this assertion vacuously (real shell PATH
		// wouldn't contain it either, guard or no guard) even with the win32 check removed
		// entirely -- so this uses "node", a real, normally-shell-probe-resolvable binary on
		// this machine (see the earlier test), specifically to prove *platform* is what changes
		// the outcome, not just "this name doesn't exist anywhere".
		vi.resetModules();
		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
		const { resolveCliPath: freshResolveCliPath } = await import('../src/utils/resolve-binary-path');

		const result = await freshResolveCliPath('node', 'node');
		expect(result).toBe('node'); // not resolved to an absolute path -- the shell probe never ran
	});

	it('memoizes repeated resolution for the same configured value + candidates', async () => {
		const realBinary = join(tempDir, 'memo-tool');
		writeFileSync(realBinary, '');
		chmodSync(realBinary, 0o755);

		const first = await resolveCliPath('memo-tool', 'memo-tool', [realBinary]);
		// Deleting the file after the first resolution proves the second call returns the cached
		// result rather than re-checking the filesystem (which would now find nothing).
		rmSync(realBinary);
		const second = await resolveCliPath('memo-tool', 'memo-tool', [realBinary]);

		expect(first).toBe(realBinary);
		expect(second).toBe(realBinary);
	});

	it('does NOT cache a failed resolution, so installing the CLI mid-session and retrying succeeds', async () => {
		const binaryPath = join(tempDir, 'just-installed-tool');

		// First call: not installed yet -- falls through to the bare name (a "failure", from this
		// function's point of view). If that failure were cached, the second call below would
		// return the same bare name forever even after the binary now genuinely exists at
		// `binaryPath` and is passed as a candidate again.
		const beforeInstall = await resolveCliPath('just-installed-tool', 'just-installed-tool', [binaryPath]);
		expect(beforeInstall).toBe('just-installed-tool');

		writeFileSync(binaryPath, '');
		chmodSync(binaryPath, 0o755);
		const afterInstall = await resolveCliPath('just-installed-tool', 'just-installed-tool', [binaryPath]);
		expect(afterInstall).toBe(binaryPath);
	});

	it('does not re-attempt a durably failing shell PATH probe on every call, only after a cooldown', async () => {
		if (process.platform === 'win32') return; // the shell probe never runs on win32 at all

		// A fresh module instance so this test's forced probe failure/cooldown state can't leak
		// into (or be polluted by) the module-level cache other tests in this file share.
		vi.resetModules();
		const { resolveCliPath: freshResolveCliPath } = await import('../src/utils/resolve-binary-path');

		// $SHELL pointed at a script that never returns forces the probe to genuinely fail via
		// execFile's own `timeout` option (as opposed to a fast ENOENT from a nonexistent path),
		// so the first call's elapsed time is a real, measurable stand-in for "the probe ran."
		const hangingShell = join(tempDir, 'hanging-shell.sh');
		writeFileSync(hangingShell, '#!/bin/sh\nsleep 30\n');
		chmodSync(hangingShell, 0o755);
		process.env.SHELL = hangingShell;

		const missingName = 'definitely-nonexistent-cli-probe-cooldown';
		const probeTimeoutMs = 1000;

		const firstStart = Date.now();
		const first = await freshResolveCliPath(missingName, missingName, [], probeTimeoutMs);
		const firstElapsed = Date.now() - firstStart;
		expect(first).toBe(missingName);
		expect(firstElapsed).toBeGreaterThanOrEqual(probeTimeoutMs - 100); // genuinely waited out the probe

		// Immediately retrying (well inside the multi-minute cooldown) must NOT re-run the probe --
		// the regression this test guards against is every single resolveCliPath call re-paying
		// the full probe timeout when the shell is durably broken (e.g. a sandboxed Electron
		// environment with no usable interactive shell), not just a one-off transient failure.
		const secondStart = Date.now();
		const second = await freshResolveCliPath(missingName, missingName, [], probeTimeoutMs);
		const secondElapsed = Date.now() - secondStart;
		expect(second).toBe(missingName);
		expect(secondElapsed).toBeLessThan(probeTimeoutMs / 2);
	}, 10_000);
});

describe('platformExecutableCandidates', () => {
	it('returns the base path unchanged on non-Windows platforms', () => {
		Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
		expect(platformExecutableCandidates('/home/user/.npm-global/bin/codex')).toEqual([
			'/home/user/.npm-global/bin/codex',
		]);
	});

	it('expands to .cmd and .exe variants (plus the bare name) on Windows, since npm and volta shim differently', () => {
		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
		expect(platformExecutableCandidates('C:\\Users\\me\\.npm-global\\bin\\codex')).toEqual([
			'C:\\Users\\me\\.npm-global\\bin\\codex.cmd',
			'C:\\Users\\me\\.npm-global\\bin\\codex.exe',
			'C:\\Users\\me\\.npm-global\\bin\\codex',
		]);
	});
});

describe('buildCliNotFoundMessage', () => {
	it('does not claim a search happened when the configured value was an explicit path', () => {
		// resolveCliPath returns an explicit path unchanged without trying any candidates or the
		// shell PATH probe (see its module doc) -- the message must not claim otherwise.
		const message = buildCliNotFoundMessage('Claude Code', '/opt/custom/claude', '/opt/custom/claude', 'Claude CLI path');
		expect(message).toContain('tried "/opt/custom/claude", the exact path configured');
		expect(message).not.toContain('common install locations');
	});

	it('describes the search performed when the configured value was a bare name', () => {
		const message = buildCliNotFoundMessage('Claude Code', 'claude', 'claude', 'Claude CLI path');
		expect(message).toContain('tried "claude", including common install locations and your shell PATH');
	});
});
