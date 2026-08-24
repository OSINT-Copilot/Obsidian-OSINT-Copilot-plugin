import { describe, it, expect } from 'vitest';
import { isLocationEntityType } from '../src/views/map-view';

describe('isLocationEntityType', () => {
    it('matches Location, Address, and GeoLocation regardless of casing or whitespace', () => {
        expect(isLocationEntityType('Location')).toBe(true);
        expect(isLocationEntityType('location')).toBe(true);
        expect(isLocationEntityType('LOCATION')).toBe(true);
        expect(isLocationEntityType('  Location  ')).toBe(true);
        expect(isLocationEntityType('Address')).toBe(true);
        expect(isLocationEntityType('address')).toBe(true);
        expect(isLocationEntityType('GeoLocation')).toBe(true);
        expect(isLocationEntityType('geolocation')).toBe(true);
    });

    it('rejects unrelated entity types and non-string/undefined values', () => {
        expect(isLocationEntityType('Person')).toBe(false);
        expect(isLocationEntityType('Event')).toBe(false);
        expect(isLocationEntityType('')).toBe(false);
        expect(isLocationEntityType(undefined)).toBe(false);
    });
});
