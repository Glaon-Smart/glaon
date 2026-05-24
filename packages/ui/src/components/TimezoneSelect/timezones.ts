// TimezoneSelect data + helpers.
//
// The IANA timezone list comes from `Intl.supportedValuesOf('timeZone')`
// — supported across modern engines (Chrome 99+, Firefox 93+,
// Safari 15.4+). On a runtime without the API we fall back to `[UTC]`
// so the picker at least surfaces *something* rather than erroring;
// the fallback is intentionally minimal because every supported
// browser meets the threshold.
//
// Display labels combine the city (last segment of the IANA id, with
// underscores prettied) and the current UTC offset
// (`Intl.DateTimeFormat` with `timeZoneName: 'longOffset'`). The
// offset is a snapshot at module-load time — we don't track DST
// transitions live; consumers that need that should observe the
// underlying value and re-mount when the wall clock changes day.

import type { SelectItemType } from '../base/select/select-shared';

const FALLBACK_TIMEZONES = ['UTC'] as const;

/**
 * Resolve the list of IANA timezone identifiers exposed by the
 * runtime. Built-in via `Intl.supportedValuesOf` on modern engines;
 * falls back to a single-entry list on engines that predate the API.
 *
 * Internal — un-exported per memory note `feedback_knip_props_interfaces.md`
 * (knip blocks PRs on unused exports). Promote when an external
 * consumer needs the raw list.
 */
function getTimezoneList(): readonly string[] {
  try {
    const intlWithSupported = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    };
    if (typeof intlWithSupported.supportedValuesOf === 'function') {
      const zones = intlWithSupported.supportedValuesOf('timeZone');
      if (zones.length > 0) return zones;
    }
  } catch {
    // Fall through to the static fallback.
  }
  return FALLBACK_TIMEZONES;
}

/**
 * Compute the `(UTC±HH:MM)` offset suffix for a given IANA timezone
 * at the current moment. Returns the string suitable for direct
 * concatenation into a display label, e.g. `'(UTC+03:00)'` for
 * `'Europe/Istanbul'`. Falls back to `'(UTC)'` for the UTC zone or
 * any zone the runtime cannot format.
 */
function formatUtcOffset(timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
    const parts = dtf.formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    const raw = tzPart?.value ?? '';
    // `longOffset` yields strings like `'GMT+03:00'`, `'GMT-05:30'`,
    // or `'GMT'` for UTC. Normalize to the Glaon convention
    // (`UTC` rather than `GMT`, explicit `±00:00` for the zero
    // offset so the column visually aligns).
    if (raw === 'GMT' || raw === '') return '(UTC)';
    return `(${raw.replace('GMT', 'UTC')})`;
  } catch {
    return '(UTC)';
  }
}

/**
 * Derive a human-readable city label from an IANA timezone id:
 * - `'Europe/Istanbul'` → `'Istanbul'`
 * - `'America/New_York'` → `'New York'`
 * - `'Pacific/Port_Moresby'` → `'Port Moresby'`
 * - `'UTC'` → `'UTC'`
 */
function cityFromTimezone(timeZone: string): string {
  const segments = timeZone.split('/');
  const last = segments[segments.length - 1] ?? timeZone;
  return last.replace(/_/g, ' ');
}

/**
 * Build a `{ id, label }` list of timezones sorted by the localized
 * city label using `Intl.Collator` so locale-aware collation kicks in
 * (e.g. Turkish ordering for Turkish callers).
 */
export function buildTimezoneItems(locale: string): SelectItemType[] {
  const zones = getTimezoneList();
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return zones
    .map((tz) => {
      const city = cityFromTimezone(tz);
      const offset = formatUtcOffset(tz);
      return { id: tz, label: `${city} — ${offset}` };
    })
    .sort((a, b) => collator.compare(a.label, b.label));
}

/**
 * Detect the user's IANA timezone from the runtime's locale settings.
 * Returns the IANA identifier (e.g. `'Europe/Istanbul'`) or `null`
 * when the runtime exposes no `Intl.DateTimeFormat` (rare).
 *
 * Pure browser API — no network call. SSR-safe (returns `null` when
 * `Intl` or the resolved-options call is unavailable).
 */
export function detectBrowserTimezone(): string | null {
  if (typeof Intl === 'undefined') return null;
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof resolved === 'string' && resolved.length > 0) return resolved;
  } catch {
    // Fall through.
  }
  return null;
}

/**
 * Diacritic-insensitive substring filter for the ComboBox's
 * `defaultFilter` prop — mirrors the helper inside
 * `CountrySelect/countries.ts`. Duplicated rather than extracted to a
 * shared util to keep this PR scoped to TimezoneSelect; a follow-up
 * can pull both copies into a shared `_internal` module when there's
 * a third caller.
 */
export function diacriticInsensitiveFilter(textValue: string, inputValue: string): boolean {
  if (!inputValue) return true;
  return normaliseForSearch(textValue).includes(normaliseForSearch(inputValue));
}

// Combining diacritical marks block — built once to keep the hot
// path allocation-free. `̀`–`ͯ` covers U+0300–U+036F.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function normaliseForSearch(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
}
