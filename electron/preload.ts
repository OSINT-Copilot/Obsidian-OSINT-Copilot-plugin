/**
 * Preload -- the entire trusted boundary between renderer and main.
 *
 * Runs with sandbox: true, so only `require('electron')` (plus events/timers/url)
 * is available here; there is deliberately no fs/child_process/process access to
 * hand out. Phase 1 grows this into the full `host` surface (vault, net, cli,
 * extract, secrets); Phase 0 exposes only what proves the bridge is wired.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('host', {
    platform: {
        os: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
    },
});
