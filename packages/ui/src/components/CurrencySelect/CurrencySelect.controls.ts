// `CurrencySelect.controls.ts` — single source of truth for
// CurrencySelect's variant matrix. Story (`CurrencySelect.stories.tsx`)
// imports the spec and spreads it into `meta.args` / `meta.argTypes`;
// MDX docs (`CurrencySelect.mdx`) reads the same spec via `<Controls />`.

import type { ControlSpec } from '../_internal/controls';
import { excludeFromArgs as defineExcludeFromArgs } from '../_internal/controls';

const sizeOptions = ['sm', 'md', 'lg'] as const;

export const currencySelectControls = {
  label: {
    type: 'text',
    default: 'Currency',
    description:
      'Visible label rendered above the trigger. Provide this, or an external `aria-label` / `aria-labelledby`, so the control always has an accessible name.',
    category: 'A11y',
  } satisfies ControlSpec<string>,
  placeholder: {
    type: 'text',
    default: 'Select a currency',
    description:
      'Hint text shown in the closed trigger when no option is selected. Never use placeholder as a substitute for the label.',
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
    description: 'Text shown when the search matches no currency.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  hint: {
    type: 'text',
    description:
      'Helper text rendered below the trigger. Doubles as the error message when `isInvalid` is true.',
    category: 'Content',
  } satisfies ControlSpec<string>,
  autoDetect: {
    type: 'boolean',
    default: true,
    description:
      "When true (default), preselect the currency of the browser locale's region on mount (Intl Locale Info `getCurrencies`). Ignored when `value` or `defaultValue` is set. One-shot — re-mount to re-detect.",
    category: 'Behavior',
  } satisfies ControlSpec<boolean>,
  defaultValue: {
    type: 'text',
    description:
      'Uncontrolled initial selection — ISO 4217 code (e.g. `TRY`, `USD`). When set, `autoDetect` is ignored.',
    category: 'Behavior',
  } satisfies ControlSpec<string>,
  size: {
    type: 'inline-radio',
    options: sizeOptions,
    default: 'md',
    description: 'Visual scale forwarded to the underlying SearchSelect.',
    category: 'Style',
  } satisfies ControlSpec<(typeof sizeOptions)[number]>,
  isDisabled: {
    type: 'boolean',
    default: false,
    description: 'Block all interaction and dim the trigger.',
    category: 'Behavior',
  } satisfies ControlSpec<boolean>,
  isInvalid: {
    type: 'boolean',
    default: false,
    description:
      'Surface validation error styling. Auto-clears once the user makes a selection; re-assert by toggling `false → true`.',
    category: 'A11y',
  } satisfies ControlSpec<boolean>,
  isRequired: {
    type: 'boolean',
    default: false,
    description: 'Mark the field as required (forwards `aria-required`).',
    category: 'A11y',
  } satisfies ControlSpec<boolean>,
  hideRequiredIndicator: {
    type: 'boolean',
    default: false,
    description: 'Hide the visual `*` next to the label even when `isRequired` is true.',
    category: 'A11y',
  } satisfies ControlSpec<boolean>,
  value: {
    type: 'text',
    description: 'Controlled selection — ISO 4217 code. Pair with `onSelectionChange`.',
    category: 'Behavior',
  } satisfies ControlSpec<string>,
  onSelectionChange: {
    type: false,
    action: 'selection-changed',
    description:
      'Fires when the selected currency changes — receives the new ISO 4217 code or `null` when cleared.',
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
// label-less usage (host renders its own label); not interactive story
// args, so they're excluded from the controls matrix here.
export const currencySelectExcludeFromArgs = defineExcludeFromArgs([
  'aria-label',
  'aria-labelledby',
] as const);
