// TimezoneSelect data + helpers.
//
// The timezone *list + labels* now come from `react-timezone-select`'s
// `useTimezoneSelect` hook (#690) — a curated set with DST-aware
// `(GMT±hh:mm) City` labels — so the old `Intl.supportedValuesOf` +
// offset-formatting helpers are gone. This module only keeps the two
// pure helpers the wrapper still needs: browser detection + the
// diacritic-insensitive search filter.

/**
 * Build the `timezones` dict fed to `react-timezone-select`'s
 * `useTimezoneSelect` (#690). Its bundled `allTimezones` is a curated
 * ~78-zone set that omits many IANA ids the wizard relies on (e.g.
 * `Europe/Istanbul`, set by the country→timezone sync), which would leave
 * the trigger blank for those. So we feed the **full** runtime IANA list
 * (`Intl.supportedValuesOf('timeZone')`) mapped to a city display name; the
 * hook still computes the DST-aware `(GMT±hh:mm)` offset prefix. Returns an
 * empty object when the API is unavailable so the caller can fall back to
 * the library's `allTimezones`.
 */
export function buildTimezoneDict(): Record<string, string> {
  try {
    const intlWithSupported = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    };
    if (typeof intlWithSupported.supportedValuesOf !== 'function') return {};
    const zones = intlWithSupported.supportedValuesOf('timeZone');
    const dict: Record<string, string> = {};
    for (const tz of zones) {
      const city = (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
      dict[tz] = city;
    }
    return dict;
  } catch {
    return {};
  }
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
 * Diacritic-insensitive substring filter for the SearchSelect's
 * `filter` prop — mirrors the helper inside `CountrySelect/countries.ts`.
 * Duplicated rather than extracted to a shared util to keep this PR
 * scoped; a follow-up can pull the copies into a shared `_internal`
 * module when there's a third caller.
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
