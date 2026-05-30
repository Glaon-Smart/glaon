// CurrencySelect data + helpers.
//
// The ISO 4217 currency list comes from `Intl.supportedValuesOf('currency')`
// (Chrome 99+, Firefox 93+, Safari 15.4+). On a runtime without the API we
// fall back to a small common set so the picker surfaces something rather
// than erroring — every supported browser meets the threshold.
//
// Display labels combine the code and the localized currency name via
// `Intl.DisplayNames(locale, { type: 'currency' })`, e.g.
// `'TRY — Turkish Lira'`. No shipped translation tables, no extra
// dependency — same runtime-locale approach as CountrySelect/TimezoneSelect.

import type { SelectItemType } from '../base/select/select-shared';

const FALLBACK_CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY', 'JPY'] as const;

/**
 * Resolve the ISO 4217 currency codes exposed by the runtime. Built-in
 * via `Intl.supportedValuesOf('currency')` on modern engines; falls back
 * to a small common set on engines that predate the API.
 */
function getCurrencyList(): readonly string[] {
  try {
    const intlWithSupported = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'currency') => string[];
    };
    if (typeof intlWithSupported.supportedValuesOf === 'function') {
      const codes = intlWithSupported.supportedValuesOf('currency');
      if (codes.length > 0) return codes;
    }
  } catch {
    // Fall through to the static fallback.
  }
  return FALLBACK_CURRENCIES;
}

/** Localized currency name for a code, e.g. `'TRY'` → `'Turkish Lira'`. */
function currencyName(code: string, locale: string): string {
  try {
    const dn = new Intl.DisplayNames([locale], { type: 'currency' });
    const name = dn.of(code);
    return name ?? code;
  } catch {
    return code;
  }
}

/**
 * Build a `{ id, label }` list of currencies sorted by the localized
 * label using `Intl.Collator`. `id` is the ISO 4217 code (e.g. `'TRY'`),
 * the canonical value persisted to HA Core's `currency`.
 */
export function buildCurrencyItems(locale: string): SelectItemType[] {
  const codes = getCurrencyList();
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return codes
    .map((code) => ({ id: code, label: `${code} — ${currencyName(code, locale)}` }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

/**
 * Detect the user's currency from their locale's region via the Intl
 * Locale Info `getCurrencies()` API. Returns the ISO 4217 code (e.g.
 * `'TRY'`) or `null` when the runtime lacks the API or the region has no
 * single currency. Pure browser API — no network call, SSR-safe.
 */
export function detectBrowserCurrency(): string | null {
  if (typeof Intl === 'undefined' || typeof navigator === 'undefined') return null;
  try {
    const tag = navigator.language;
    if (!tag) return null;
    const locale = new Intl.Locale(tag) as unknown as {
      region?: string;
      getCurrencies?: () => string[];
    };
    if (locale.region === undefined || locale.region === '') return null;
    const regional = new Intl.Locale('und', { region: locale.region }) as unknown as {
      getCurrencies?: () => string[];
      currencies?: string[];
    };
    const list =
      typeof regional.getCurrencies === 'function' ? regional.getCurrencies() : regional.currencies;
    const first = Array.isArray(list) ? list[0] : undefined;
    return typeof first === 'string' && first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

/**
 * Diacritic-insensitive substring filter for the ComboBox's
 * `defaultFilter` prop — mirrors the helper in `TimezoneSelect/timezones.ts`
 * and `CountrySelect/countries.ts`. Duplicated rather than extracted to
 * keep this PR scoped; #589 tracks pulling the copies into a shared
 * `_internal` module.
 */
export function diacriticInsensitiveFilter(textValue: string, inputValue: string): boolean {
  if (!inputValue) return true;
  return normaliseForSearch(textValue).includes(normaliseForSearch(inputValue));
}

const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function normaliseForSearch(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
}
