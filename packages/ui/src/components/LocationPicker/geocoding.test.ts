import { afterEach, describe, expect, it, vi } from 'vitest';

import { nominatimGeocode } from './geocoding';

function mockFetchOnce(json: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        json: () => Promise.resolve(json),
      } as Response),
    ),
  );
}

function lastRequestUrl(): URL {
  const fetchMock = global.fetch as unknown as { mock: { calls: unknown[][] } };
  return new URL(String(fetchMock.mock.calls[0]?.[0]));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nominatimGeocode', () => {
  it('resolves blank queries to an empty list without fetching', async () => {
    mockFetchOnce([]);
    expect(await nominatimGeocode('   ')).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps Nominatim rows to suggestions and drops non-finite coordinates', async () => {
    mockFetchOnce([
      { place_id: 1, display_name: 'Istanbul', lat: '41.0082', lon: '28.9784' },
      { place_id: 2, display_name: 'Bad', lat: 'x', lon: 'y' },
    ]);
    const out = await nominatimGeocode('istanbul');
    expect(out).toEqual([{ id: '1', label: 'Istanbul', lat: 41.0082, lng: 28.9784 }]);
  });

  it('scopes the search to the country via countrycodes (#666)', async () => {
    mockFetchOnce([]);
    await nominatimGeocode('main st', undefined, 'en', 'TR');
    expect(lastRequestUrl().searchParams.get('countrycodes')).toBe('tr');
  });

  it('omits countrycodes when no/invalid country code is given (#666)', async () => {
    mockFetchOnce([]);
    await nominatimGeocode('main st', undefined, 'en', 'TRX');
    expect(lastRequestUrl().searchParams.has('countrycodes')).toBe(false);
  });

  it('forwards the locale as accept-language', async () => {
    mockFetchOnce([]);
    await nominatimGeocode('paris', undefined, 'fr');
    expect(lastRequestUrl().searchParams.get('accept-language')).toBe('fr');
  });

  it('throws on a non-ok response', async () => {
    mockFetchOnce(null, false);
    await expect(nominatimGeocode('boom')).rejects.toThrow(/Nominatim/);
  });
});
