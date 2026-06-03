// CurrencySelect data + helpers.
//
// The ISO 4217 currency list comes from `Intl.supportedValuesOf('currency')`
// (Chrome 99+, Firefox 93+, Safari 15.4+). On a runtime without the API we
// fall back to a small common set so the picker surfaces something rather
// than erroring — every supported browser meets the threshold.
//
// Rows show the **code only** (e.g. `'TRY'`) plus the currency's flag (added
// by the component). The localized currency *name* is deliberately dropped:
// it is locale-dependent and reads as noise in a multi-language wizard.

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

/**
 * Build a `{ id, label }` list of currencies sorted alphabetically by code.
 * `id` and `label` are both the ISO 4217 code (e.g. `'TRY'`) — the canonical
 * value persisted to HA Core's `currency`. The component layers the flag on
 * top as the row/trigger `icon`. No locale needed (code-only display).
 */
export function buildCurrencyItems(): SelectItemType[] {
  return [...getCurrencyList()]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({ id: code, label: code }));
}

/**
 * Map an ISO 4217 currency code to the ISO 3166-1 alpha-2 country code for
 * its flag. The currency code's first two letters are the country code for
 * almost every national currency (`USD`→`us`, `TRY`→`tr`, `GBP`→`gb`);
 * `EUR` maps to the EU flag. Supranational/metal codes (`XAF`, `XAU`, …)
 * yield an `x…` code that `flag-icons` has no asset for, so the flag box
 * renders empty — the code text still identifies the row.
 */
export function currencyFlagCode(code: string): string {
  if (code === 'EUR') return 'eu';
  return code.slice(0, 2).toLowerCase();
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
