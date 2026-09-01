import { describe, it, expect } from 'vitest';
import { assertRequestAllowed, hostAllowed, isPrivateAddress } from '../src/host/node/net-guard';

/**
 * The port CREATES this risk: moving requestUrl into main gives it unrestricted
 * network access while the enricher allowlist lives in renderer code that is now the
 * untrusted side. Enricher URL templates are LLM- and user-authored.
 */
describe('Outbound request guard', () => {
    describe('domain allowlist', () => {
        it('accepts an exact host and its subdomains', () => {
            expect(hostAllowed('api.example.com', ['api.example.com'])).toBe(true);
            expect(hostAllowed('v2.api.example.com', ['api.example.com'])).toBe(true);
            expect(hostAllowed('api.example.com', ['*.example.com'])).toBe(true);
        });

        it('rejects lookalikes that merely end with the pattern', () => {
            // The classic bug: endsWith('example.com') would accept this.
            expect(hostAllowed('evil-example.com', ['example.com'])).toBe(false);
            expect(hostAllowed('example.com.attacker.net', ['example.com'])).toBe(false);
        });

        it('is case-insensitive and ignores empty entries', () => {
            expect(hostAllowed('API.Example.COM', ['api.example.com'])).toBe(true);
            expect(hostAllowed('api.example.com', ['', '  '])).toBe(false);
        });
    });

    describe('private address detection', () => {
        it('catches loopback, RFC1918, link-local and CGNAT', () => {
            for (const address of [
                '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
                '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
            ]) {
                expect(isPrivateAddress(address), address).toBe(true);
            }
        });

        it('catches the cloud metadata endpoint specifically', () => {
            // The single most valuable SSRF target in a cloud deployment.
            expect(isPrivateAddress('169.254.169.254')).toBe(true);
            expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
        });

        it('catches IPv6 loopback and unique-local', () => {
            for (const address of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1']) {
                expect(isPrivateAddress(address), address).toBe(true);
            }
        });

        it('allows public addresses', () => {
            for (const address of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700::1']) {
                expect(isPrivateAddress(address), address).toBe(false);
            }
        });
    });

    describe('assertRequestAllowed', () => {
        it('refuses non-HTTP schemes', async () => {
            await expect(assertRequestAllowed('file:///etc/passwd')).rejects.toThrow(/non-HTTP scheme/);
        });

        it('refuses a host outside the allowlist', async () => {
            await expect(assertRequestAllowed('https://evil.test/x', ['api.example.com']))
                .rejects.toThrow(/not in this enricher's allowedDomains/);
        });

        it('refuses a literal private address even when allowlisted', async () => {
            await expect(assertRequestAllowed('http://169.254.169.254/latest/meta-data/', ['169.254.169.254']))
                .rejects.toThrow(/private address/);
        });

        it('refuses loopback by literal IP', async () => {
            await expect(assertRequestAllowed('http://127.0.0.1:8080/admin', ['127.0.0.1']))
                .rejects.toThrow(/private address/);
        });

        it('allows a public host with no allowlist configured', async () => {
            await expect(assertRequestAllowed('https://8.8.8.8/')).resolves.toBeUndefined();
        });

        it('rejects a malformed URL', async () => {
            await expect(assertRequestAllowed('not a url')).rejects.toThrow(/Malformed URL/);
        });
    });
});
