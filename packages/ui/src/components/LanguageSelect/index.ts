// Per memory note `feedback_knip_props_interfaces.md`: keep prop /
// utility types un-exported until an external consumer needs them. The
// component is re-exported via the package barrel
// (`packages/ui/src/index.ts`) as `@glaon/ui`'s `LanguageSelect`. Helpers
// (`buildLanguageItems`, `detectBrowserLanguage`, ...) ship in the same
// module — add named exports here when an app feature imports them.

export { LanguageSelect } from './LanguageSelect';
