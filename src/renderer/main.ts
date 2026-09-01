/**
 * Renderer entry. Phase 0 only proves the shell boots with the final security
 * flags on and the preload bridge reachable; Phase 3 mounts the real workspace here.
 */
declare global {
    interface Window {
        host?: { platform: { os: string; arch: string; electron: string; chrome: string } };
    }
}

const root = document.getElementById('app');
const platform = window.host?.platform;

if (root) {
    root.textContent = platform
        ? `OSINT Copilot shell — Electron ${platform.electron} / Chromium ${platform.chrome} on ${platform.os}-${platform.arch}`
        : 'OSINT Copilot shell — preload bridge NOT reachable';
    root.setAttribute('data-bridge', platform ? 'ok' : 'missing');
}

export {};
