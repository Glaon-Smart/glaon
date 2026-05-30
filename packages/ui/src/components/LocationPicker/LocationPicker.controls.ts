// `LocationPicker.controls.ts` — single source of truth for
// LocationPicker's variant matrix. Story (`LocationPicker.stories.tsx`)
// imports the spec and spreads it into `meta.args` / `meta.argTypes`;
// MDX docs (`LocationPicker.mdx`) reads the same spec via `<Controls />`.

import type { ControlSpec } from '../_internal/controls';
import { excludeFromArgs as defineExcludeFromArgs } from '../_internal/controls';

const sizeOptions = ['sm', 'md', 'lg'] as const;
const localeOptions = ['', 'tr-TR', 'en-US', 'de-DE', 'fr-FR', 'ar-SA'] as const;

export const locationPickerControls = {
  searchLabel: {
    type: 'text',
    default: 'Search for an address',
    description:
      'Accessible name for the optional search input (no visible label is rendered, per the HA zone-editor design). Only shown when a `geocode` callback is injected.',
    category: 'A11y',
  } satisfies ControlSpec<string>,
  placeholder: {
    type: 'text',
    default: 'Search for an address',
    description: 'Hint text inside the search input.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  latitudeLabel: {
    type: 'text',
    default: 'Latitude',
    description: 'Visible label for the latitude field (host supplies localized copy).',
    category: 'Content',
  } satisfies ControlSpec<string>,
  longitudeLabel: {
    type: 'text',
    default: 'Longitude',
    description: 'Visible label for the longitude field.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  radiusLabel: {
    type: 'text',
    default: 'Radius',
    description: 'Visible label for the radius field.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  radiusUnit: {
    type: 'text',
    default: 'm',
    description: 'Unit suffix shown inside the radius field (e.g. `m`, `metre`).',
    category: 'Content',
  } satisfies ControlSpec<string>,
  hint: {
    type: 'text',
    description:
      'Helper text rendered below the fields. Doubles as the error message when `isInvalid` is true.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  offlineLabel: {
    type: 'text',
    default: 'Map unavailable offline — enter coordinates manually.',
    description:
      'Copy shown over the map area when the browser is offline. The numeric fields stay editable.',
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
    description: 'Visual scale of the controls.',
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
      'Initial map zoom when no `value` / `defaultValue` is set. The picker auto-zooms to 14 once a location is picked.',
    category: 'Behavior',
  } satisfies ControlSpec<number>,
  defaultRadius: {
    type: 'number',
    default: 100,
    min: 1,
    max: 5000,
    step: 10,
    description: 'Radius (metres) applied when a location is set without an explicit radius.',
    category: 'Behavior',
  } satisfies ControlSpec<number>,
  isDisabled: {
    type: 'boolean',
    default: false,
    description:
      "Block all interaction — fields are dim, suggestions don't open, marker + radius handle drag are disabled, map is non-interactive.",
    category: 'Behavior',
  } satisfies ControlSpec<boolean>,
  isInvalid: {
    type: 'boolean',
    default: false,
    description: 'Surface validation error styling on the fields + hint.',
    category: 'A11y',
  } satisfies ControlSpec<boolean>,
  value: {
    type: false,
    description: 'Controlled selection — `{ lat, lng, radius?, address? }`. Pair with `onChange`.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  defaultValue: {
    type: false,
    description: 'Uncontrolled initial selection — `{ lat, lng, radius?, address? }`.',
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
      'Async geocoder `(query, signal?, locale?) => Promise<Suggestion[]>`. When omitted the search box is hidden. Pass `nominatimGeocode` for the free OSM default.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  onChange: {
    type: false,
    action: 'changed',
    description:
      'Fires on every settled change — geocode pick, marker drag, radius handle drag, or field edit. Receives `{ lat, lng, radius, address? }`.',
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
