/**
 * Electron main process.
 *
 * The security flags below are FINAL, not provisional. They are set in Phase 0
 * on purpose: retrofitting a sandbox onto a working renderer is how this kind of
 * port goes wrong, and this app spawns local binaries, runs user-authored HTTP
 * enrichers, and renders LLM output as Markdown. Nothing here loosens later.
 */
import { app, BrowserWindow, session, shell } from 'electron';
import * as path from 'path';

const RENDERER_DIR = path.join(__dirname, 'renderer');

/**
 * connect-src 'none' is the load-bearing directive: all network egress goes
 * through IPC to main, so a markdown-injection XSS in LLM or enricher output
 * cannot exfiltrate the vault. img-src will gain osint-vault: in Phase 4.
 */
const CSP = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'none'",
].join('; ');

function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
        },
    });

    win.once('ready-to-show', () => win.show());

    // Deny all navigation away from the app, and route external links to the OS browser.
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
        return { action: 'deny' };
    });

    void win.loadFile(path.join(RENDERER_DIR, 'index.html'));

    // `--smoke` boots the shell, asserts the renderer rendered and the preload
    // bridge is reachable, prints a result line and exits. Runs in CI without a
    // display via xvfb; superseded by the Playwright _electron test in Phase 6.
    if (process.argv.includes('--smoke')) {
        win.webContents.on('did-fail-load', (_e, code, desc, url) => {
            console.log(`SMOKE FAIL: did-fail-load ${code} ${desc} ${url}`);
            app.exit(1);
        });
        win.webContents.on('console-message', (_e, _lvl, message) => {
            console.log(`  renderer console: ${message}`);
        });
        setTimeout(() => { console.log('SMOKE FAIL: timed out'); app.exit(1); }, 15000);
        win.webContents.once('did-finish-load', () => {
            void win.webContents
                .executeJavaScript(`(() => {
                    const el = document.getElementById('app');
                    return { bridge: el && el.getAttribute('data-bridge'), text: el && el.textContent };
                })()`)
                .then((result: { bridge: string | null; text: string | null }) => {
                    const ok = result.bridge === 'ok';
                    console.log(`SMOKE ${ok ? 'PASS' : 'FAIL'}: ${result.text}`);
                    app.exit(ok ? 0 : 1);
                })
                .catch((error: unknown) => {
                    console.log(`SMOKE FAIL: ${String(error)}`);
                    app.exit(1);
                });
        });
    }

    return win;
}

void app.whenReady().then(() => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [CSP],
            },
        });
    });

    // No renderer should ever be granted a device/media permission.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
