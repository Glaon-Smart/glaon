// TimezoneSelect data + helpers.
//
// The timezone *list + labels* come from `react-timezone-select`'s
// `useTimezoneSelect` hook (#690), fed the library's curated `allTimezones`
// set — DST-aware, offset-grouped `(GMT±hh:mm) City1, City2…` labels — so
// the old `Intl.supportedValuesOf` + offset-formatting helpers are gone.
// This module only keeps the two pure helpers the wrapper still needs:
// browser detection + the diacritic-insensitive search filter.

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
