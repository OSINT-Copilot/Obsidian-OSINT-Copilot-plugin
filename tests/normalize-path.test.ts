import { describe, it, expect } from 'vitest';
import { normalizePath } from 'obsidian';

/**
 * Guards 110 call sites across 26 files. The mock this replaced did none of
 * NFC, trailing-slash stripping, the "/" fallback, or NBSP folding.
 */
describe('normalizePath', () => {
    it('converts backslashes and collapses repeated separators', () => {
        expect(normalizePath('a\\b\\c')).toBe('a/b/c');
        expect(normalizePath('a//b///c')).toBe('a/b/c');
        expect(normalizePath('a\\\\b//c')).toBe('a/b/c');
    });

    it('strips leading AND trailing slashes', () => {
        expect(normalizePath('/a/b/')).toBe('a/b');
        expect(normalizePath('///a///')).toBe('a');
    });

    it('resolves empty and root-only input to "/"', () => {
        // getAbstractFileByPath("") must reach the root folder, not return null.
        expect(normalizePath('')).toBe('/');
        expect(normalizePath('/')).toBe('/');
        expect(normalizePath('///')).toBe('/');
    });

    it('normalizes to NFC so APFS NFD paths match composed index keys', () => {
        const nfd = 'Müller/note.md';   // decomposed: u + combining diaeresis
        const nfc = 'Müller/note.md';    // composed: u-umlaut
        expect(nfd).not.toBe(nfc);
        expect(normalizePath(nfd)).toBe(normalizePath(nfc));
        expect(normalizePath(nfd)).toBe(nfc);
    });

    it('normalizes NFD Cyrillic and Arabic labels too', () => {
        expect(normalizePath('OSINTCopilot/ftm/Person/Й.md'.normalize('NFD')))
            .toBe('OSINTCopilot/ftm/Person/Й.md'.normalize('NFC'));
    });

    it('folds NBSP and narrow NBSP to a plain space', () => {
        // These arrive in labels pasted out of PDFs via api-service extraction.
        expect(normalizePath('a b')).toBe('a b');
        expect(normalizePath('a b')).toBe('a b');
    });

    it('is idempotent', () => {
        for (const p of ['', '/', 'a\\b/', '/Müller//x.md', 'a b']) {
            expect(normalizePath(normalizePath(p))).toBe(normalizePath(p));
        }
    });
});
