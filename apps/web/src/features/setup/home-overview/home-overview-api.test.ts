import { describe, expect, it, vi } from 'vitest';

import { countryTimeZones, lookupCountryCenter } from './home-overview-api';

describe('lookupCountryCenter (#648)', () => {
  it("geocodes the country's localized display name and returns the first center", async () => {
    const geocode = vi.fn().mockResolvedValue([
      { lat: 39.0, lng: 35.0 },
      { lat: 0, lng: 0 },
    ]);
    const center = await lookupCountryCenter('TR', 'en', geocode);
    expect(center).toEqual({ lat: 39.0, lng: 35.0 });
    // The query is the localized region name, not the raw ISO code.
    // ICU may render "Turkey" or "Türkiye" depending on the runtime data.
    const query = geocode.mock.calls[0]?.[0] as string;
    expect(query).not.toBe('TR');
    expect(query.toLowerCase()).toMatch(/t[üu]rk/);
  });

  it('passes the locale through to the geocoder for localized names', async () => {
    const geocode = vi.fn().mockResolvedValue([{ lat: 51, lng: 9 }]);
    await lookupCountryCenter('DE', 'de', geocode);
    expect(geocode.mock.calls[0]?.[2]).toBe('de');
    expect((geocode.mock.calls[0]?.[0] as string).toLowerCase()).toContain('deutschland');
  });

  it('returns null when the geocoder yields no results', async () => {
    const geocode = vi.fn().mockResolvedValue([]);
    expect(await lookupCountryCenter('FR', 'en', geocode)).toBeNull();
  });

  it('returns null when the geocoder rejects (offline / rate-limited)', async () => {
    const geocode = vi.fn().mockRejectedValue(new Error('network'));
    expect(await lookupCountryCenter('FR', 'en', geocode)).toBeNull();
  });
});

describe('countryTimeZones (#648)', () => {
  it('returns the IANA zone for a single-timezone country', () => {
    const zones = countryTimeZones('TR');
    // Runtimes with Intl Locale Info return ['Europe/Istanbul']; older
    // ones return [] (the caller then skips the timezone sync).
    if (zones.length > 0) {
      expect(zones).toContain('Europe/Istanbul');
    }
  });

  it('returns an array (possibly empty) and never throws for odd input', () => {
    expect(Array.isArray(countryTimeZones('ZZ'))).toBe(true);
    expect(Array.isArray(countryTimeZones(''))).toBe(true);
  });

  it('uppercases the region code', () => {
    expect(countryTimeZones('tr')).toEqual(countryTimeZones('TR'));
  });
});
