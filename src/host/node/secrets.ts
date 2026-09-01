/**
 * Secret resolution -- main process only.
 *
 * Secrets are resolved and injected here so plaintext never reaches the renderer,
 * which renders LLM and enricher output and is therefore the untrusted side. The
 * renderer passes a SecretRef; it never receives the value, and there is no host API
 * that would let it.
 *
 * Three sources, in the order a deployment would prefer them:
 *   keychain   OS-backed via Electron safeStorage. Preferred for new credentials.
 *   env        Process environment.
 *   vault-file Plaintext under OSINTCopilot/custom/credentials/. Kept for
 *              compatibility with existing vaults; deprecated.
 */
import * as fsp from 'fs/promises';
import * as nodePath from 'path';
import type { SecretRef } from '../types';
import * as vaultFs from './vault';

const DEFAULT_CREDENTIALS_FOLDER = 'OSINTCopilot/custom/credentials';

/** Injected by main; absent under vitest, where the keychain source simply misses. */
let keychain: {
    isEncryptionAvailable(): boolean;
    encryptString(value: string): Buffer;
    decryptString(buffer: Buffer): string;
} | null = null;

let keychainFile = '';

export function configureKeychain(safeStorage: typeof keychain, userDataDir: string): void {
    keychain = safeStorage;
    keychainFile = nodePath.join(userDataDir, 'credentials.enc.json');
}

async function readKeychainStore(): Promise<Record<string, string>> {
    try {
        return JSON.parse(await fsp.readFile(keychainFile, 'utf-8')) as Record<string, string>;
    } catch {
        return {};
    }
}

async function writeKeychainStore(store: Record<string, string>): Promise<void> {
    await fsp.mkdir(nodePath.dirname(keychainFile), { recursive: true });
    // 0600: the ciphertext is safeStorage-encrypted, but there is no reason for it to
    // be world-readable as well.
    await fsp.writeFile(keychainFile, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export async function setKeychain(name: string, value: string): Promise<void> {
    if (!keychain?.isEncryptionAvailable()) {
        throw new Error('OS keychain is unavailable on this system');
    }
    const store = await readKeychainStore();
    store[name] = keychain.encryptString(value).toString('base64');
    await writeKeychainStore(store);
}

export async function deleteKeychain(name: string): Promise<void> {
    const store = await readKeychainStore();
    delete store[name];
    await writeKeychainStore(store);
}

export async function listKeychain(): Promise<string[]> {
    return Object.keys(await readKeychainStore()).sort();
}

/** Never exposed over IPC. Main-internal only. */
export async function resolveSecret(ref: SecretRef): Promise<string | null> {
    if (!ref?.name) return null;

    if (ref.source === 'env') {
        return process.env[ref.name] ?? null;
    }

    if (ref.source === 'keychain') {
        if (!keychain?.isEncryptionAvailable()) return null;
        const store = await readKeychainStore();
        const encrypted = store[ref.name];
        if (!encrypted) return null;
        try {
            return keychain.decryptString(Buffer.from(encrypted, 'base64'));
        } catch {
            return null;
        }
    }

    // vault-file: confined to the credentials folder, so a crafted relative path
    // cannot read arbitrary vault content.
    const relative = ref.name.replace(/^[/\\]+/, '');
    if (relative.includes('..')) return null;
    const path = relative.startsWith(DEFAULT_CREDENTIALS_FOLDER)
        ? relative
        : `${DEFAULT_CREDENTIALS_FOLDER}/${relative}`;
    try {
        const value = (await vaultFs.read(path)).trim();
        return value || null;
    } catch {
        return null;
    }
}

/** Existence check for the renderer -- returns a boolean, never the value. */
export async function hasSecret(ref: SecretRef): Promise<boolean> {
    return (await resolveSecret(ref)) !== null;
}
