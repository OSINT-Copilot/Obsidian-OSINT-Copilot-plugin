/**
 * Renderer entry. Phase 1 proves the shell boots with the final security flags on
 * and the host bridge reachable; Phase 3 mounts the real workspace here.
 */
import { host } from '../host';

const root = document.getElementById('app');

if (root) {
    let text: string;
    let ok = false;
    try {
        const p = host.platform;
        text = `OSINT Copilot shell \u2014 Electron ${p.electron} / Chromium ${p.chrome} on ${p.os}-${p.arch}`;
        ok = true;
    } catch (error) {
        text = `OSINT Copilot shell \u2014 host bridge NOT reachable: ${String(error)}`;
    }
    root.textContent = text;
    root.setAttribute('data-bridge', ok ? 'ok' : 'missing');
}

export {};
