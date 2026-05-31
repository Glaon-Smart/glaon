// `LanguageSelect.controls.ts` — single source of truth for
// LanguageSelect's variant matrix. Story (`LanguageSelect.stories.tsx`)
// imports the spec and spreads it into `meta.args` / `meta.argTypes`;
// MDX docs (`LanguageSelect.mdx`) reads the same spec via `<Controls />`.

import type { ControlSpec } from '../_internal/controls';
import { excludeFromArgs as defineExcludeFromArgs } from '../_internal/controls';

const sizeOptions = ['sm', 'md', 'lg'] as const;
const localeOptions = ['', 'tr-TR', 'en-US', 'de-DE', 'fr-FR', 'ar-SA'] as const;

export const languageSelectControls = {
  label: {
    type: 'text',
    default: 'Language',
    description:
      'Visible label rendered above the trigger. Provide this, or an external `aria-label` / `aria-labelledby`, so the control always has an accessible name.',
    category: 'A11y',
  } satisfies ControlSpec<string>,
  placeholder: {
    type: 'text',
    default: 'Select a language',
    description: 'Hint text shown when no option is selected.',
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
      "When true (default), preselect the browser's language on mount if it is one of `options`. Ignored when `value` or `defaultValue` is set. One-shot.",
    category: 'Behavior',
  } satisfies ControlSpec<boolean>,
  locale: {
    type: 'select',
    options: localeOptions,
    default: '',
    description:
      'BCP-47 locale used for the localized language names + label collation. Leave empty to use the browser default (`navigator.language`).',
    category: 'Content',
  } satisfies ControlSpec<(typeof localeOptions)[number]>,
  defaultValue: {
    type: 'text',
    description:
      'Uncontrolled initial selection — a language code from `options` (e.g. `tr`). When set, `autoDetect` is ignored.',
    category: 'Behavior',
  } satisfies ControlSpec<string>,
  size: {
    type: 'inline-radio',
    options: sizeOptions,
    default: 'md',
    description: 'Visual scale forwarded to the underlying ComboBox.',
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
    description: 'Surface validation error styling. Auto-clears once the user makes a selection.',
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
    description:
      'Controlled selection — a language code from `options`. Pair with `onSelectionChange`.',
    category: 'Behavior',
  } satisfies ControlSpec<string>,
  options: {
    type: false,
    description:
      'Supported language codes (BCP-47 primary subtags, e.g. `["en","tr"]`). When empty, a common fallback list renders.',
    category: 'Behavior',
  } satisfies ControlSpec<unknown>,
  onSelectionChange: {
    type: false,
    action: 'selection-changed',
    description: 'Fires when the selected language changes — receives the code or `null`.',
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
// label-less usage; not interactive story args, so they're excluded.
export const languageSelectExcludeFromArgs = defineExcludeFromArgs([
  'aria-label',
  'aria-labelledby',
] as const);
