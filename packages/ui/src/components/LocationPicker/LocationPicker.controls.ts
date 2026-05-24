// `LocationPicker.controls.ts` — single source of truth for
// LocationPicker's variant matrix. Story (`LocationPicker.stories.tsx`)
// imports the spec and spreads it into `meta.args` / `meta.argTypes`;
// MDX docs (`LocationPicker.mdx`) reads the same spec via `<Controls />`.

import type { ControlSpec } from '../_internal/controls';
import { excludeFromArgs as defineExcludeFromArgs } from '../_internal/controls';

const sizeOptions = ['sm', 'md', 'lg'] as const;
const localeOptions = ['', 'tr-TR', 'en-US', 'de-DE', 'fr-FR', 'ar-SA'] as const;

export const locationPickerControls = {
  label: {
    type: 'text',
    default: 'Location',
    description:
      'Visible label rendered above the search input. Always provide one — labels satisfy axe `label` and pair the picker with assistive tech automatically.',
    category: 'A11y',
  } satisfies ControlSpec<string>,
  placeholder: {
    type: 'text',
    default: 'Search for an address',
    description:
      'Hint text shown inside the search input. Never use placeholder as a substitute for the label.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  hint: {
    type: 'text',
    description:
      'Helper text rendered below the search input. Doubles as the error message when `isInvalid` is true.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  locale: {
    type: 'select',
    options: localeOptions,
    default: '',
    description:
      'BCP-47 locale forwarded to the geocoder. Leave empty to use the browser default (`navigator.language`).',
    category: 'Content',
  } satisfies ControlSpec<(typeof localeOptions)[number]>,
  size: {
    type: 'inline-radio',
    options: sizeOptions,
    default: 'md',
    description:
      'Visual scale of the search input. `sm` for compact toolbars, `md` (default) for forms, `lg` for hero affordances.',
    category: 'Style',
  } satisfies ControlSpec<(typeof sizeOptions)[number]>,
  mapHeight: {
    type: 'number',
    default: 320,
    min: 200,
    max: 800,
    step: 20,
    description: 'Height of the map canvas in pixels. The width fills the wrapper.',
    category: 'Style',
  } satisfies ControlSpec<number>,
  defaultZoom: {
    type: 'number',
    default: 4,
    min: 1,
    max: 18,
    step: 1,
    description:
      'Initial map zoom when no `value` / `defaultValue` is set. The picker auto-zooms to 14 whenever the user picks a suggestion.',
    category: 'Behavior',
  } satisfies ControlSpec<number>,
  isDisabled: {
    type: 'boolean',
    default: false,
    description:
      "Block all interaction — input is dim, suggestions don't open, marker drag is disabled, map is non-interactive.",
    category: 'Behavior',
  } satisfies ControlSpec<boolean>,
  isInvalid: {
    type: 'boolean',
    default: false,
    description:
      'Surface validation error styling on the search input. Auto-clears once the user makes a selection; toggling `false → true` re-arms the error.',
    category: 'A11y',
  } satisfies ControlSpec<boolean>,
  isRequired: {
    type: 'boolean',
    default: false,
    description:
      'Mark the field as required (renders an indicator next to the label and forwards `aria-required`).',
    category: 'A11y',
  } satisfies ControlSpec<boolean>,
  hideRequiredIndicator: {
    type: 'boolean',
    default: false,
    description:
      'Hide the visual `*` next to the label even when `isRequired` is true. Keep `isRequired` set so the a11y contract still reports the field as required.',
    category: 'A11y',
  } satisfies ControlSpec<boolean>,
  value: {
    type: false,
    description: 'Controlled selection — `{ lat, lng, address? }`. Pair with `onChange`.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  defaultValue: {
    type: false,
    description: 'Uncontrolled initial selection — `{ lat, lng, address? }`.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  defaultCenter: {
    type: false,
    description:
      'Initial map centre `{ lat, lng }` when no `value` / `defaultValue` is set. Defaults to Istanbul.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  geocode: {
    type: false,
    description:
      'Async geocoder `(query, signal?, locale?) => Promise<Suggestion[]>`. Pass `nominatimGeocode` for the free OSM default.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  onChange: {
    type: false,
    action: 'changed',
    description:
      'Fires on every settled selection — autocomplete pick or marker drag. Receives `{ lat, lng, address? }`.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  className: {
    type: false,
    description: 'Tailwind override hook for the outer wrapper.',
    category: 'Style',
  } satisfies ControlSpec<string>,
} as const;

// No additional excludes — every public prop on `LocationPicker` is
// represented above. The helper export is still required by the F6
// prop-coverage gate's named-export contract.
export const locationPickerExcludeFromArgs = defineExcludeFromArgs([] as const);
