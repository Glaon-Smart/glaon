// CountrySelect data + helpers.
//
// We deliberately ship only the ISO 3166-1 alpha-2 code list (249
// entries). Display names are derived at runtime via
// `Intl.DisplayNames(locale, { type: 'region' })` so the same list
// renders correctly in any locale the browser supports — no shipped
// translation tables, no extra dependency.
//
// `buildCountryItems(locale)` returns a list of `{ id, label }` items
// sorted by the localized label using `Intl.Collator`. Codes that the
// runtime can't localize (rare — usually deprecated entries) are
// filtered out rather than displayed as raw two-letter codes.

import type { SelectItemType } from '../base/select/select-shared';

/**
 * ISO 3166-1 alpha-2 country codes (249 entries, source: ISO 3166
 * Maintenance Agency). Order is alphabetical to make grep-by-code
 * easy; the picker re-sorts by localized name at render time.
 *
 * Internal — un-exported per memory note
 * `feedback_knip_props_interfaces.md` (knip blocks PRs on unused
 * exports). Promote to a named export here + in `index.ts` when an
 * external consumer needs to read or re-use the list.
 */
const COUNTRY_CODES = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
] as const;

// `CountryCode` is only used internally by `detectBrowserCountry`'s
// return type; kept un-exported per the same memory-note rationale
// as `COUNTRY_CODES` above.
type CountryCode = (typeof COUNTRY_CODES)[number];

/**
 * Build a `{ id, label }` list sorted by the localized country name.
 * The returned items satisfy the kit `SelectItemType` shape so the
 * `<ComboBox>` consumes them directly.
 */
export function buildCountryItems(locale: string): SelectItemType[] {
  let displayNames: Intl.DisplayNames;
  try {
    displayNames = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    // Fallback if the runtime rejects the locale (e.g. malformed BCP-47).
    displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  }
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return (
    COUNTRY_CODES.map((code) => {
      const label = displayNames.of(code) ?? code;
      return { id: code, label };
    })
      // Drop codes the runtime couldn't localize — surfacing raw alpha-2
      // codes in a country picker is worse than silently omitting them.
      .filter((item) => item.label !== item.id)
      .sort((a, b) => collator.compare(a.label, b.label))
  );
}

/**
 * Derive the user's country from the browser's locale settings.
 * Returns the ISO 3166-1 alpha-2 region tag (e.g. `'TR'`, `'US'`) or
 * `null` when no region can be inferred (locale has no region tag, or
 * the runtime exposes no `navigator.language`).
 *
 * Pure browser API — no network call. SSR-safe (returns `null` when
 * `navigator` is undefined).
 */
export function detectBrowserCountry(): CountryCode | null {
  if (typeof navigator === 'undefined') return null;
  const candidates: string[] = [];
  if (navigator.language) candidates.push(navigator.language);
  // `navigator.languages` is typed as a non-nullable `ReadonlyArray<string>`
  // in lib.dom.d.ts, so the runtime presence check that eslint flagged
  // as dead code is dropped; an empty array is harmless to spread.
  candidates.push(...navigator.languages);
  for (const tag of candidates) {
    const region = extractRegion(tag);
    if (region && (COUNTRY_CODES as readonly string[]).includes(region)) {
      return region as CountryCode;
    }
  }
  return null;
}

/**
 * Extract the region subtag (two uppercase letters) from a BCP-47
 * language tag. Returns `null` when the tag has no region subtag.
 *
 * Examples:
 * - `'tr-TR'` → `'TR'`
 * - `'en-US'` → `'US'`
 * - `'zh-Hans-CN'` → `'CN'`
 * - `'en'` → `null`
 */
function extractRegion(tag: string): string | null {
  const parts = tag.split('-');
  // Region is a 2-letter uppercase subtag; iterate right-to-left so
  // we pick the rightmost region tag in extended tags.
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part && /^[A-Z]{2}$/.test(part)) return part;
    if (part && /^[a-z]{2}$/.test(part)) return part.toUpperCase();
  }
  return null;
}

/**
 * Diacritic-insensitive substring filter for the ComboBox's
 * `defaultFilter` prop. Normalises both sides to NFD, strips combining
 * marks, lowercases — so `"turkiye"` matches `"Türkiye"` and
 * `"reunion"` matches `"Réunion"`.
 */
export function diacriticInsensitiveFilter(textValue: string, inputValue: string): boolean {
  if (!inputValue) return true;
  return normaliseForSearch(textValue).includes(normaliseForSearch(inputValue));
}

// Combining diacritical marks block — built once to keep the hot
// path allocation-free. `̀`–`ͯ` covers U+0300–U+036F.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function normaliseForSearch(s: string): string {
  // NFD splits accented characters into base + combining mark; the
  // regex strips the combining marks (U+0300–U+036F).
  return s.normalize('NFD').replace(COMBINING_MARKS_RE, '').toLowerCase();
}
