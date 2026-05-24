// LocationPicker — geocoding helpers.
//
// `nominatimGeocode` is the batteries-included default that hits the
// free Nominatim OSM endpoint. Per CLAUDE.md's Component
// Data-Fetching Boundary rule, LocationPicker itself does not call
// `fetch` — it takes a `geocode` prop and the host (or, in
// Storybook, the story file) wires this helper as the callback.
//
// Production deployments that exceed Nominatim's free-tier rate
// limit (1 req/sec per user, 250 tiles/sec across all users) should
// swap in a paid provider (Geoapify, LocationIQ) or a self-hosted
// Nominatim — the wrapper signature `(query) => Promise<Suggestion[]>`
// is provider-agnostic by design.

/**
 * One geocoding suggestion. The shape is provider-agnostic so the
 * picker can render any backend that resolves to coordinates + a
 * human-readable label.
 */
export interface GeocodeSuggestion {
  /** Stable id — used as the `<SelectItem>` key. */
  id: string;
  /** Human-readable label rendered in the suggestion list. */
  label: string;
  /** Latitude (WGS84 decimal degrees). */
  lat: number;
  /** Longitude (WGS84 decimal degrees). */
  lng: number;
}

/** Default Nominatim endpoint — public, free, rate-limited. */
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

/**
 * Nominatim-backed geocoder. Suitable as a `geocode` prop for
 * LocationPicker.
 *
 * Returns up to 10 suggestions per query. Empty / blank queries
 * resolve to `[]` so the autocomplete list collapses cleanly.
 *
 * @param query  Free-form address string.
 * @param signal Optional AbortSignal — wired by the picker to cancel
 *               in-flight requests when the user keeps typing.
 * @param locale Optional BCP-47 tag — passed to Nominatim's
 *               `accept-language` query so labels come back in the
 *               user's language when available.
 */
export async function nominatimGeocode(
  query: string,
  signal?: AbortSignal,
  locale?: string,
): Promise<GeocodeSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const params = new URLSearchParams({
    q: trimmed,
    format: 'jsonv2',
    limit: '10',
    addressdetails: '0',
  });
  if (locale !== undefined && locale.length > 0) {
    params.set('accept-language', locale);
  }

  const url = `${NOMINATIM_BASE}/search?${params.toString()}`;
  const init: RequestInit = { headers: { Accept: 'application/json' } };
  if (signal !== undefined) init.signal = signal;

  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Nominatim geocoding failed: ${response.status.toString()}`);
  }
  const raw = (await response.json()) as NominatimResult[];
  return raw
    .map((row) => {
      const lat = Number.parseFloat(row.lat);
      const lng = Number.parseFloat(row.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        id: row.place_id.toString(),
        label: row.display_name,
        lat,
        lng,
      } satisfies GeocodeSuggestion;
    })
    .filter((s): s is GeocodeSuggestion => s !== null);
}

interface NominatimResult {
  place_id: number | string;
  display_name: string;
  lat: string;
  lon: string;
}
