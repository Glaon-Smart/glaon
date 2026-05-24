// Per memory note `feedback_knip_props_interfaces.md`: keep prop /
// utility types un-exported until an external consumer needs them.
// The component itself is re-exported via the package barrel
// (`packages/ui/src/index.ts`) and reachable as `@glaon/ui`'s
// `TimezoneSelect`. Helpers (`buildTimezoneItems`,
// `detectBrowserTimezone`, `diacriticInsensitiveFilter`, ...) ship in
// the same module — add named exports here when an app feature
// starts importing them and the same PR wires the consumer.

export { TimezoneSelect } from './TimezoneSelect';
