/**
 * Pure path helpers. `path` is nothing but string manipulation, so the sandboxed
 * renderer needs no Node module for it -- only the platform separator, which comes
 * from the host snapshot.
 */
import { host } from './index';

function sep(): string {
    return host.platform.pathSep;
}

/** Joins segments with the platform separator, dropping empties. */
export function join(...segments: string[]): string {
    const s = sep();
    const parts = segments.filter(Boolean);
    if (parts.length === 0) return '';
    const joined = parts.join(s);
    // Collapse duplicate separators introduced by segments that already ended in one,
    // but preserve a leading UNC "\\\\" or POSIX root.
    const leading = joined.startsWith(s) ? s : '';
    const body = joined.split(s).filter(Boolean).join(s);
    return leading + body;
}

export function dirname(p: string): string {
    const normalized = p.replace(/[\\/]+$/, '');
    const at = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    if (at < 0) return '.';
    if (at === 0) return normalized[0];
    return normalized.slice(0, at);
}

export function basename(p: string): string {
    const normalized = p.replace(/[\\/]+$/, '');
    const at = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    return at < 0 ? normalized : normalized.slice(at + 1);
}

export function extname(p: string): string {
    const name = basename(p);
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot);
}
