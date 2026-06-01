// Public surface of @glaon/core/i18n. apps/web + apps/mobile import
// from here for the locale negotiator + shared types; the i18next
// runtime stays in the platform packages so @glaon/core respects
// ADR 0004's platform-agnostic boundary.

export {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  negotiateLocale,
  resolveFromCandidates,
  type LocaleNegotiationInput,
  type SupportedLocale,
} from './locale-negotiator';
export { HA_LANGUAGES } from './ha-languages';
export type { I18nNamespaces, I18nResource, I18nResources, LocaleChoice } from './types';
export {
  clearHaTranslationsCache,
  fetchHaTranslations,
  invalidateHaTranslations,
  type FetchHaTranslationsOptions,
  type HaTranslationsCache,
} from './ha-bridge';
