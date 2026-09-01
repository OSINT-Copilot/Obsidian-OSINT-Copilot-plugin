/**
 * Outbound request guard -- main process only.
 *
 * The port creates this risk: moving requestUrl into main gives it unrestricted
 * network access, while the enricher domain allowlist lives in renderer code that is
 * now the untrusted side. Enricher URL templates are LLM- and user-authored, so the
 * allowlist is re-enforced here, and private address space is refused after DNS
 * resolution (a public hostname can resolve to 169.254.169.254).
 */
import { lookup } from 'dns/promises';
import { isIP } from 'net';

export class BlockedRequestError extends Error {}

/** Matches the renderer-side check, which stays as a fast fail and a clear message. */
export function hostAllowed(hostname: string, allowed: string[]): boolean {
    const host = hostname.toLowerCase();
    return allowed.some((entry) => {
        const pattern = entry.trim().toLowerCase().replace(/^\*\./, '');
        if (!pattern) return false;
        return host === pattern || host.endsWith(`.${pattern}`);
    });
}

export function isPrivateAddress(address: string): boolean {
    const version = isIP(address);
    if (version === 4) {
        const [a, b] = address.split('.').map(Number);
        return (
            a === 0 || a === 10 || a === 127 ||
            (a === 169 && b === 254) ||              // link-local, incl. cloud metadata
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) ||    // CGNAT
            a >= 224                                  // multicast / reserved
        );
    }
    if (version === 6) {
        const v6 = address.toLowerCase();
        if (v6 === '::1' || v6 === '::') return true;
        if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
        // IPv4-mapped: ::ffff:169.254.169.254
        const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateAddress(mapped[1]);
        return false;
    }
    return false;
}

export async function assertRequestAllowed(url: string, allowedDomains?: string[]): Promise<void> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new BlockedRequestError(`Malformed URL: ${url}`);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new BlockedRequestError(`Refused non-HTTP scheme: ${parsed.protocol}`);
    }

    if (allowedDomains?.length && !hostAllowed(parsed.hostname, allowedDomains)) {
        throw new BlockedRequestError(
            `Host "${parsed.hostname}" is not in this enricher's allowedDomains.`,
        );
    }

    const literal = isIP(parsed.hostname);
    if (literal) {
        if (isPrivateAddress(parsed.hostname)) {
            throw new BlockedRequestError(`Refused request to private address ${parsed.hostname}`);
        }
        return;
    }

    let addresses: { address: string }[];
    try {
        addresses = await lookup(parsed.hostname, { all: true });
    } catch {
        return;   // let the request itself surface a DNS failure with a better message
    }
    for (const { address } of addresses) {
        if (isPrivateAddress(address)) {
            throw new BlockedRequestError(
                `Refused: "${parsed.hostname}" resolves to private address ${address}`,
            );
        }
    }
}
