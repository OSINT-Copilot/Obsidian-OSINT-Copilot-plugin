import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { extractAddressComponents, GeocodingService, GeocodingErrorType } from '../src/services/geocoding-service';

describe('extractAddressComponents', () => {
    it('extracts city/state/country/postalCode from a full address object', () => {
        const result = extractAddressComponents({
            house_number: '10',
            road: 'Main St',
            city: 'Springfield',
            state: 'Illinois',
            country: 'USA',
            postcode: '62701',
        });
        expect(result).toEqual({
            city: 'Springfield',
            state: 'Illinois',
            country: 'USA',
            postalCode: '62701',
        });
    });

    it('falls back city -> town -> village -> municipality in that priority order', () => {
        expect(extractAddressComponents({ town: 'Townsville' }).city).toBe('Townsville');
        expect(extractAddressComponents({ village: 'Villageton' }).city).toBe('Villageton');
        expect(extractAddressComponents({ municipality: 'Municiptown' }).city).toBe('Municiptown');
        expect(
            extractAddressComponents({ city: 'CityName', town: 'Townsville', village: 'Villageton' }).city,
        ).toBe('CityName');
        expect(
            extractAddressComponents({ town: 'Townsville', village: 'Villageton', municipality: 'Municiptown' }).city,
        ).toBe('Townsville');
    });

    it('returns an all-undefined object when address is undefined', () => {
        expect(extractAddressComponents(undefined)).toEqual({
            city: undefined,
            state: undefined,
            country: undefined,
            postalCode: undefined,
        });
    });
});

// A fresh instance per test avoids the real rate-limit sleep in enforceRateLimit() carrying over
// from a prior test's `lastRequestTime` (only the terminal, non-retried paths are covered here --
// 429/non-200 responses trigger real exponential-backoff delays via reverseGeocodeWithRetry,
// matching how this codebase has never unit-tested the retry/backoff timing of the existing
// forward-geocode path either).
describe('GeocodingService.reverseGeocodeWithRetry', () => {
    let service: GeocodingService;

    beforeEach(() => {
        service = new GeocodingService();
        vi.mocked(requestUrl).mockReset();
    });

    it('resolves an address from a successful Nominatim /reverse response', async () => {
        vi.mocked(requestUrl).mockResolvedValue({
            status: 200,
            json: {
                lat: '48.8584',
                lon: '2.2945',
                display_name: 'Eiffel Tower, Paris, France',
                address: { house_number: '5', road: 'Avenue Anatole France', city: 'Paris', country: 'France', postcode: '75007' },
            },
        } as any);

        const result = await service.reverseGeocodeWithRetry(48.8584, 2.2945);

        expect(result.address).toBe('5 Avenue Anatole France');
        expect(result.city).toBe('Paris');
        expect(result.country).toBe('France');
        expect(result.postalCode).toBe('75007');
    });

    it('treats a Nominatim 200-with-`error`-field response as NotFound, not a false success', async () => {
        // This is the quirk /reverse uses instead of /search's empty-array no-match -- regressing
        // the `result.error` check would silently start treating "no address" as a valid hit.
        vi.mocked(requestUrl).mockResolvedValue({
            status: 200,
            json: { error: 'Unable to geocode' },
        } as any);

        await expect(service.reverseGeocodeWithRetry(0, 0)).rejects.toMatchObject({
            type: GeocodingErrorType.NotFound,
        });
        expect(requestUrl).toHaveBeenCalledTimes(1); // NotFound is not retried
    });

    it('rejects out-of-range coordinates as InvalidInput without making a network call', async () => {
        await expect(service.reverseGeocodeWithRetry(999, 0)).rejects.toMatchObject({
            type: GeocodingErrorType.InvalidInput,
        });
        expect(requestUrl).not.toHaveBeenCalled();
    });
});
