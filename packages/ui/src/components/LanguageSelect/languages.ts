// LanguageSelect data + helpers.
//
// Unlike CountrySelect/TimezoneSelect/CurrencySelect, the candidate set
// isn't a fixed Intl table — it's the app's *supported* languages (Glaon
// ships en/tr today; HA could supply more later). So the option codes are
// injected via the `options` prop; this module only turns codes into
// localized labels (`Intl.DisplayNames(locale, { type: 'language' })`),
// sorts them, and filters — the same runtime-locale approach as the sister
// pickers, no shipped translation tables.

import type { SelectItemType } from '../base/select/select-shared';

// Standalone fallback for stories / consumers that don't inject a list.
// Apps pass their own supported set (e.g. @glaon/core's SUPPORTED_LOCALES).
const DEFAULT_LANGUAGES = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar', 'ru', 'ja'] as const;

/** Localized language name, e.g. `'tr'` → `'Türkçe'` (in tr) / `'Turkish'` (in en). */
function languageName(code: string, locale: string): string {
  try {
    const dn = new Intl.DisplayNames([locale], { type: 'language' });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Build a `{ id, label }` list from the injected language codes, sorted by
 * the localized label via `Intl.Collator`. `id` is the BCP-47 code the
 * consumer persists (e.g. `'tr'`). Falls back to a common set when
 * `options` is empty so the primitive renders something in isolation.
 */
export function buildLanguageItems(options: readonly string[], locale: string): SelectItemType[] {
  const codes = options.length > 0 ? options : DEFAULT_LANGUAGES;
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return codes
    .map((code) => ({ id: code, label: languageName(code, locale) }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

/**
 * Detect the browser's language (primary subtag of `navigator.language`)
 * when it's one of the supported `options`. Returns `null` otherwise (or
 * with no `navigator`), so the caller leaves the field unset. Pure browser
 * API — no network call, SSR-safe.
 */
export function detectBrowserLanguage(options: readonly string[]): string | null {
  if (typeof navigator === 'undefined') return null;
  const tag = navigator.language;
  if (!tag) return null;
  const primary = tag.split('-')[0]?.toLowerCase();
  if (primary === undefined || primary === '') return null;
  const supported = (options.length > 0 ? options : DEFAULT_LANGUAGES).map((c) => c.toLowerCase());
  return supported.includes(primary) ? primary : null;
}

/**
 * Diacritic-insensitive substring filter — mirrors the helper in the
 * sister pickers. Duplicated to keep this PR scoped; #589 tracks pulling
 * the copies into a shared `_internal` module.
 */
export function diacriticInsensitiveFilter(textValue: string, inputValue: string): boolean {
  if (!inputValue) return true;
  return normaliseForSearch(textValue).includes(normaliseForSearch(inputValue));
}

const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function normaliseForSearch(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
}
