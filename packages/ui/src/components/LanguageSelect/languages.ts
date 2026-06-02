// LanguageSelect data + helpers.
//
// Unlike CountrySelect/TimezoneSelect/CurrencySelect, the candidate set
// isn't a fixed Intl table — it's the app's *supported* languages (Glaon
// gets the HA-supported set from the device via `GET /api/setup`, #683). So
// the option codes are injected via the `options` prop; this module turns
// each code into a label and sorts them — no shipped translation tables.
//
// Label (#683): the language's **autonym** only — its name in its own
// language (`'de'` → `Deutsch`, `'tr'` → `Türkçe`), from `Intl.DisplayNames`.

import type { SelectItemType } from '../base/select/select-shared';

// Standalone fallback for stories / consumers that don't inject a list, and
// for the sub-second window before the device seed lands.
const DEFAULT_LANGUAGES = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar', 'ru', 'ja'] as const;

/** Language name in `locale`, e.g. `'tr'` → `'Türkçe'` (tr) / `'Turkish'` (en). */
function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The language's autonym — its name in its own language (`'de'` → `'Deutsch'`). */
function languageAutonym(code: string): string {
  return languageName(code, code);
}

/**
 * Build a `{ id, label }` list from the injected language codes (#683).
 * `label` is the language's **autonym** (its name in its own language);
 * `id` is the BCP-47 code the consumer persists. Sorted by the autonym via
 * `Intl.Collator`. Falls back to a common set when `options` is empty.
 */
export function buildLanguageItems(options: readonly string[], locale: string): SelectItemType[] {
  const codes = options.length > 0 ? options : DEFAULT_LANGUAGES;
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return codes
    .map((code) => ({ id: code, label: languageAutonym(code) }))
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
