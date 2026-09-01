/**
 * Vault full-text search.
 *
 * A linear scan over cachedRead, deliberately. cachedRead is keyed on path+mtime+size,
 * so a second search over an unchanged vault costs no I/O at all -- which makes an
 * inverted index premature until measurement on a real case vault says otherwise.
 */
import type { App } from '../../obsidian-shim/app';
import type { TFile } from '../../obsidian-shim/vault/tfile';

export interface SearchHit {
    file: TFile;
    matches: number;
    /** First matching line, trimmed, for the results list. */
    snippet: string;
    line: number;
}

export async function searchVault(app: App, query: string, limit = 100): Promise<SearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];

    const hits: SearchHit[] = [];
    for (const file of app.vault.getMarkdownFiles()) {
        let content: string;
        try {
            content = await app.vault.cachedRead(file);
        } catch {
            continue;   // deleted mid-scan
        }

        const haystack = content.toLowerCase();
        if (!haystack.includes(needle)) continue;

        let matches = 0;
        let at = haystack.indexOf(needle);
        while (at !== -1) {
            matches++;
            at = haystack.indexOf(needle, at + needle.length);
        }

        const lines = content.split('\n');
        const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(needle));
        hits.push({
            file,
            matches,
            line: lineIndex + 1,
            snippet: (lines[lineIndex] ?? '').trim().slice(0, 200),
        });

        if (hits.length >= limit) break;
    }

    return hits.sort((a, b) => b.matches - a.matches || a.file.path.localeCompare(b.file.path));
}
