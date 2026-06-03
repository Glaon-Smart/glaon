// `CountrySelect.controls.ts` — single source of truth for
// CountrySelect's variant matrix. Story (`CountrySelect.stories.tsx`)
// imports the spec and spreads it into `meta.args` / `meta.argTypes`;
// MDX docs (`CountrySelect.mdx`) reads the same spec via `<Controls />`.

import type { ControlSpec } from '../_internal/controls';
import { excludeFromArgs as defineExcludeFromArgs } from '../_internal/controls';

const sizeOptions = ['sm', 'md', 'lg'] as const;
const localeOptions = ['', 'tr-TR', 'en-US', 'de-DE', 'fr-FR', 'ar-SA'] as const;

export const countrySelectControls = {
  label: {
    type: 'text',
    default: 'Country',
    description:
      'Visible label rendered above the trigger. Always provide one — labels satisfy axe `label` and pair the picker with assistive tech automatically.',
    category: 'A11y',
  } satisfies ControlSpec<string>,
  placeholder: {
    type: 'text',
    default: 'Select a country',
    description:
      'Hint text shown in the closed trigger when no country is selected. Never use placeholder as a substitute for the label.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  searchPlaceholder: {
    type: 'text',
    default: 'Search',
    description: 'Placeholder inside the in-popover search field.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  noResultsLabel: {
    type: 'text',
    default: 'No results found',
    description: 'Text shown in the popover when the search matches no country.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  hint: {
    type: 'text',
    description:
      'Helper text rendered below the trigger. Doubles as the error message when `isInvalid` is true (the kit re-styles it red and adds `aria-describedby`).',
    category: 'Content',
  } satisfies ControlSpec<string>,
  autoDetect: {
    type: 'boolean',
    default: true,
    description:
      'When true (default), pre-select the country derived from `navigator.language` on mount. Ignored when `value` or `defaultValue` is set. Detection is one-shot — re-mount to re-detect.',
    category: 'Behavior',
  } satisfies ControlSpec<boolean>,
  locale: {
    type: 'select',
    options: localeOptions,
    default: '',
    description:
      'BCP-47 locale used to localize country names and sort them. Leave empty to use the browser default (`navigator.language`).',
    category: 'Content',
  } satisfies ControlSpec<(typeof localeOptions)[number]>,
  defaultValue: {
    type: 'text',
    description:
      'Uncontrolled initial selection — ISO 3166-1 alpha-2 code (e.g. `TR`, `US`). When set, `autoDetect` is ignored.',
    category: 'Behavior',
  } satisfies ControlSpec<string>,
  size: {
    type: 'inline-radio',
    options: sizeOptions,
    default: 'md',
    description:
      'Visual scale forwarded to the underlying ComboBox. `sm` for compact toolbars, `md` (default) for forms, `lg` for hero affordances.',
    category: 'Style',
  } satisfies ControlSpec<(typeof sizeOptions)[number]>,
  isDisabled: {
    type: 'boolean',
    default: false,
    description:
      'Block all interaction and dim the trigger. The kit forwards `aria-disabled` so axe and assistive tech treat the field as inert.',
    category: 'Behavior',
  } satisfies ControlSpec<boolean>,
  isInvalid: {
    type: 'boolean',
    default: false,
    description:
      'Surface validation error styling (red border + ring on the trigger). Pair with `hint` to describe the error; the kit wires `aria-invalid` + `aria-describedby` automatically.',
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
    type: 'text',
    description:
      'Controlled selection — ISO 3166-1 alpha-2 code. Pair with `onSelectionChange` to manage state outside.',
    category: 'Behavior',
  } satisfies ControlSpec<string>,
  onSelectionChange: {
    type: false,
    action: 'selection-changed',
    description:
      'Fires when the selected country changes — receives the new ISO code or `null` when cleared.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  className: {
    type: false,
    description: 'Tailwind override hook for the outer wrapper.',
    category: 'Style',
  } satisfies ControlSpec<string>,
  popoverClassName: {
    type: false,
    description: 'Tailwind override hook for the popover surface that wraps the option list.',
    category: 'Style',
  } satisfies ControlSpec<string>,
} as const;

// `aria-label` / `aria-labelledby` are a11y passthroughs for the
// label-less usage (host renders its own label); they aren't interactive
// story args, so they're excluded from the controls matrix here.
export const countrySelectExcludeFromArgs = defineExcludeFromArgs([
  'aria-label',
  'aria-labelledby',
] as const);
