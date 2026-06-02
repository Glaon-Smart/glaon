// HA-supported language codes (#666). This is the *Home Assistant* set of
// translation languages — distinct from Glaon's own UI `SUPPORTED_LOCALES`
// (currently en/tr). The wizard's Home Overview language picker offers
// this full set because the chosen value maps to HA Core's `language`
// (the device's language), not only the Glaon UI bundle.
//
// HA exposes no clean pre-auth endpoint that lists its supported
// languages (the list lives in the frontend build), so we ship a static
// snapshot of HA's translation set. BCP-47 codes; the picker localizes
// each via `Intl.DisplayNames`. Region/script variants (en-GB, pt-BR,
// zh-Hans, …) are kept verbatim so they round-trip to HA unchanged.
//
// Maintenance: refresh against HA frontend's `translationMetadata` when a
// new HA language ships. The wizard always merges in the device's current
// `get_config.language` even if it's not in this snapshot, so an
// unlisted-but-active language is never dropped.

export const HA_LANGUAGES = [
  'af',
  'ar',
  'bg',
  'bn',
  'ca',
  'cs',
  'cy',
  'da',
  'de',
  'el',
  'en',
  'en-GB',
  'eo',
  'es',
  'es-419',
  'et',
  'eu',
  'fa',
  'fi',
  'fr',
  'fy',
  'gl',
  'gsw',
  'he',
  'hi',
  'hr',
  'hu',
  'hy',
  'id',
  'is',
  'it',
  'ja',
  'ka',
  'ko',
  'lb',
  'lt',
  'lv',
  'ml',
  'nb',
  'nl',
  'nn',
  'pl',
  'pt',
  'pt-BR',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr',
  'sr-Latn',
  'sv',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'ur',
  'vi',
  'zh-Hans',
  'zh-Hant',
] as const;
