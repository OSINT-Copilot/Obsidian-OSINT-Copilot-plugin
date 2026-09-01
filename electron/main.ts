/**
 * Electron main process.
 *
 * The security flags below are FINAL, not provisional. They are set in Phase 0
 * on purpose: retrofitting a sandbox onto a working renderer is how this kind of
 * port goes wrong, and this app spawns local binaries, runs user-authored HTTP
 * enrichers, and renders LLM output as Markdown. Nothing here loosens later.
 */
import { app, BrowserWindow, Menu, dialog, protocol, safeStorage, session, shell } from 'electron';
import * as path from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { readFile, realpath } from 'fs/promises';
import * as vaultFs from '../src/host/node/vault';
import { configureKeychain } from '../src/host/node/secrets';
import { platformSnapshotArg, registerHostHandlers } from './ipc';

const RENDERER_DIR = path.join(__dirname, 'renderer');

/**
 * Remote-tile preference, read once at startup because the CSP is fixed for the
 * session. Lives in userData rather than the vault: it is a privacy setting about
 * this machine, not investigation data. `--allow-remote-tiles` overrides for a run.
 */
function readTilePreference(): boolean {
    if (process.argv.includes('--allow-remote-tiles')) return true;
    try {
        const file = path.join(app.getPath('userData'), 'preferences.json');
        return JSON.parse(readFileSync(file, 'utf-8')).allowRemoteTiles === true;
    } catch {
        return false;
    }
}

/** `--vault=<dir>` opens a vault directly, bypassing the picker (used by tests/CI). */
function vaultArg(): string[] {
    const arg = process.argv.find((a) => a.startsWith('--vault='));
    return arg ? [arg] : [];
}

/**
 * connect-src 'none' is the load-bearing directive: all network egress goes through
 * IPC to main, so a markdown-injection XSS in LLM or enricher output cannot
 * exfiltrate the vault.
 *
 * Remote map tiles are the one deliberate hole, and they are OFF by default. Turning
 * them on widens img-src to https:, which for an OSINT tool is a real disclosure
 * decision -- every pan and zoom tells a tile server which coordinates an analyst is
 * looking at. That is the user's call to make explicitly, not a silent default.
 */
function buildCsp(allowRemoteTiles: boolean): string {
    return [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: osint-vault:${allowRemoteTiles ? ' https:' : ''}`,
        "font-src 'self'",
        "connect-src 'none'",
    ].join('; ');
}

function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: [platformSnapshotArg(), ...vaultArg()],
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
                .executeJavaScript(`new Promise((resolve) => {
                    const read = () => {
                        const el = document.getElementById('app');
                        return el && el.getAttribute('data-boot') ? {
                            boot: el.getAttribute('data-boot'),
                            views: el.getAttribute('data-views'),
                            commands: el.getAttribute('data-commands'),
                            vault: el.getAttribute('data-vault'),
                            text: (el.textContent || '').slice(0, 160),
                        } : null;
                    };
                    const tick = () => { const r = read(); r ? resolve(r) : setTimeout(tick, 100); };
                    tick();
                })`)
                .then((result: { boot: string; views: string; commands: string; vault: string; text: string }) => {
                    const ok = result.boot === 'ready';
                    const shot = process.argv.find((a) => a.startsWith('--screenshot='));
                    const finish = () => {
                        console.log(ok
                            ? `SMOKE PASS: booted vault=${result.vault} views=${result.views} commands=${result.commands}`
                            : `SMOKE FAIL: boot=${result.boot} ${result.text}`);
                        app.exit(ok ? 0 : 1);
                    };
                    const openView = process.argv.find((a) => a.startsWith('--open-view='));
                    const openFile = process.argv.find((a) => a.startsWith('--open-file='));
                    const pane = process.argv.find((a) => a.startsWith('--pane='));
                    const script = [
                        openView && `await window.__openView(${JSON.stringify(openView.slice('--open-view='.length))});`,
                        openFile && `await window.__openFile(${JSON.stringify(openFile.slice('--open-file='.length))});`,
                        pane && `window.__selectPane(${JSON.stringify(pane.slice('--pane='.length))});`,
                        process.argv.includes('--open-settings') && 'window.__openSettings();',
                    ].filter(Boolean).join('\n');
                    const maybeOpen = script
                        ? win.webContents.executeJavaScript(`(async () => { ${script} })()`)
                        : Promise.resolve();

                    if (shot) {
                        void maybeOpen.then(() => new Promise((r) => setTimeout(r, 1200))).then(() => {
                            return win.webContents.capturePage().then(async (image) => {
                                const { writeFile } = await import('fs/promises');
                                await writeFile(shot.slice('--screenshot='.length), image.toPNG());
                                finish();
                            });
                        });
                        return;
                    }
                    console.log(ok
                        ? `SMOKE PASS: booted vault=${result.vault} views=${result.views} commands=${result.commands}`
                        : `SMOKE FAIL: boot=${result.boot} ${result.text}`);
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

/**
 * Must run BEFORE app.whenReady(); registering later is silently ignored.
 * Backs vault.getResourcePath, used for entity image thumbnails on graph nodes.
 */
protocol.registerSchemesAsPrivileged([
    { scheme: 'osint-vault', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

void app.whenReady().then(() => {
    registerHostHandlers();

    const csp = buildCsp(readTilePreference());
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [csp],
            },
        });
    });

    // No renderer should ever be granted a device/media permission.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    // safeStorage is only available after ready; the keychain source is inert until this runs.
    configureKeychain(safeStorage, app.getPath('userData'));

    registerVaultProtocol();
    buildAppMenu();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

/**
 * Serves vault files to the renderer.
 *
 * The path arrives from entity.properties.filePath, which is LLM-writable, so it is
 * resolved and checked against the vault root here -- the renderer is the untrusted
 * side and cannot be trusted to have done it.
 */
function registerVaultProtocol(): void {
    protocol.handle('osint-vault', async (request) => {
        try {
            const url = new URL(request.url);
            const vaultPath = decodeURIComponent(`${url.hostname}${url.pathname}`);
            const absolute = vaultFs.absolutePathOf(vaultPath);   // throws if it escapes
            const real = await realpath(absolute);
            if (!real.startsWith(await realpath(vaultFs.basePath()))) {
                return new Response('Forbidden', { status: 403 });
            }
            return new Response(await readFile(real));
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });
}

/** Minimal app menu; the vault picker and the tile toggle need to be reachable. */
function buildAppMenu(): void {
    const allowTiles = readTilePreference();
    const menu = Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                { label: 'Open vault…', accelerator: 'CmdOrCtrl+O', click: () => void openVaultPicker() },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            label: 'Privacy',
            submenu: [
                {
                    label: 'Allow remote map tiles',
                    type: 'checkbox',
                    checked: allowTiles,
                    click: (item) => {
                        writeTilePreference(item.checked);
                        dialog.showMessageBox({
                            message: 'Restart OSINT Copilot to apply the map tile setting.',
                            detail: item.checked
                                ? 'Map tiles will be fetched from OpenStreetMap. Tile servers can see which coordinates you view.'
                                : 'Map tiles will be blocked. The map will render without a basemap.',
                        });
                    },
                },
            ],
        },
        { role: 'viewMenu' },
    ]);
    Menu.setApplicationMenu(menu);
}

function writeTilePreference(allow: boolean): void {
    const file = path.join(app.getPath('userData'), 'preferences.json');
    let current: Record<string, unknown> = {};
    try {
        current = JSON.parse(readFileSync(file, 'utf-8'));
    } catch { /* first write */ }
    writeFileSync(file, JSON.stringify({ ...current, allowRemoteTiles: allow }, null, 2));
}

async function openVaultPicker(): Promise<void> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!window) return;
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return;
    writeFileSync(
        path.join(app.getPath('userData'), 'recent-vault.json'),
        JSON.stringify({ lastVault: result.filePaths[0] }, null, 2),
    );
    window.reload();
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
