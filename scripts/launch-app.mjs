/**
 * Launches the standalone app.
 *
 * Exists because some host environments (VS Code / Claude Code integrated
 * terminals among them) export ELECTRON_RUN_AS_NODE=1, which makes the Electron
 * binary run as plain Node -- `electron --version` then prints the embedded Node
 * version and `electron main.js` silently never opens a window. We strip those
 * vars here rather than relying on a shell-specific `env -u`.
 */
import { spawn } from 'child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const child = spawn(electron, ['dist-app/main.js', ...process.argv.slice(2)], {
    env,
    stdio: 'inherit',
});
child.on('close', (code) => process.exit(code ?? 0));
