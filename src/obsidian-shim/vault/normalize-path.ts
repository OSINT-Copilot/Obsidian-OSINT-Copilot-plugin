/**
 * Faithful reimplementation of Obsidian's `normalizePath`.
 *
 * Order matters and every step is load-bearing:
 *  1. collapse runs of `\` and `/` into a single `/`
 *  2. strip leading AND trailing slashes
 *  3. replace NBSP (U+00A0) and narrow NBSP (U+202F) with a plain space
 *     -- these arrive routinely in labels pasted out of PDFs (api-service.ts)
 *  4. Unicode NFC
 *     -- macOS APFS hands back NFD from readdir. Entity labels here are often
 *        non-ASCII (Cyrillic, accented Latin, Arabic). Without this, an NFD path
 *        from the watcher misses the NFC index key, getAbstractFileByPath returns
 *        null, entity-manager takes its `create` branch, and you get EEXIST.
 *  5. empty result becomes "/" so it resolves to the vault root folder
 *
 * The mock in tests/obsidian-mock.ts had none of 2-5; see tests/normalize-path.test.ts.
 */
export function normalizePath(path: string): string {
    const normalized = path
        .replace(/([\\/])+/g, '/')
        .replace(/(^\/+|\/+$)/g, '')
        .replace(/\u00A0|\u202F/g, ' ')
        .normalize('NFC');
    return normalized === '' ? '/' : normalized;
}
