// Glaon CountrySelect — searchable country picker that wraps the
// kit `<ComboBox>` (`packages/ui/src/components/base/select/combobox.tsx`).
//
// Domain logic this wrapper adds on top of the kit ComboBox:
//
//   - Bundled ISO 3166-1 alpha-2 list, localized at render time via
//     `Intl.DisplayNames` — no shipped translation tables, no dep.
//   - Diacritic-insensitive search (`turkiye` → `Türkiye`, `reunion`
//     → `Réunion`) plus searchable ISO code (`TR` → `Türkiye`).
//   - Optional one-shot browser locale auto-detection — when on, the
//     picker preselects the user's country derived from
//     `navigator.language` / `navigator.languages`. Pure browser API,
//     no network call.
//
// State machine — three modes:
//
//   - **Controlled.** Host passes `value`; we forward it as
//     `selectedKey`. Host owns the state.
//   - **Uncontrolled, explicit default.** Host passes `defaultValue`;
//     we forward it as `defaultSelectedKey`. RAC owns state.
//   - **Uncontrolled, auto-detect.** Host passes neither and
//     `autoDetect` is true. We hold an internal `selectedKey` so the
//     async detection result (resolved in `useEffect`) can be injected
//     after mount.
//
// Per CLAUDE.md's UUI Source Rule and Component Data-Fetching Boundary:
// the visual + popover positioning + RAC plumbing come from the kit;
// this wrapper's contribution is the prop API + the static country
// list + locale detection. No network call lives here.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';

import { ComboBox, SelectItem, type SelectItemType } from '../Select';
import { buildCountryItems, detectBrowserCountry, diacriticInsensitiveFilter } from './countries';

// Types stay un-exported per memory note `feedback_knip_props_interfaces.md`
// — `react-docgen-typescript` still resolves the prop names for the
// F6 prop-coverage gate without a top-level `export`. Promote them
// to the index.ts barrel once an external consumer needs them.
type CountrySelectSize = 'sm' | 'md' | 'lg';

interface CountrySelectProps {
  /**
   * Controlled selection — the ISO 3166-1 alpha-2 country code (e.g.
   * `'TR'`, `'US'`). Pair with `onSelectionChange` to manage state
   * outside. When set, `defaultValue` and `autoDetect` are ignored.
   */
  value?: string;
  /**
   * Uncontrolled initial selection — the ISO 3166-1 alpha-2 country
   * code to start with. When set, `autoDetect` is ignored.
   */
  defaultValue?: string;
  /**
   * Fires when the user (or the auto-detect path) changes the
   * selection. Receives the ISO 3166-1 alpha-2 code, or `null` when
   * the selection is cleared.
   */
  onSelectionChange?: (iso: string | null) => void;
  /**
   * When `true` (default), pre-select the user's country derived from
   * the browser's locale on mount. Ignored when `value` or
   * `defaultValue` is set. Detection is one-shot — re-mount to
   * re-detect.
   * @default true
   */
  autoDetect?: boolean;
  /**
   * BCP-47 locale tag used to localize country names and sort them.
   * Defaults to `navigator.language` in the browser, `'en'` on a
   * runtime without `navigator` (e.g. SSR).
   */
  locale?: string;
  /** Field label rendered above the trigger. */
  label?: string;
  /** Placeholder text shown when no option is selected. */
  placeholder?: string;
  /** Helper text shown under the trigger; doubles as the error
   *  message when `isInvalid` is true. */
  hint?: ReactNode;
  /** Block all interaction and dim the trigger. */
  isDisabled?: boolean;
  /** Surface validation error styling. Pair with `hint` to describe
   *  the error; the kit wires `aria-invalid` + `aria-describedby`. */
  isInvalid?: boolean;
  /** Mark the field as required (renders an indicator next to the
   *  label and forwards `aria-required`). */
  isRequired?: boolean;
  /** Hide the visual `*` next to the label even when `isRequired`
   *  is true. Keeps the a11y contract. */
  hideRequiredIndicator?: boolean;
  /**
   * Visual scale of the underlying ComboBox.
   * @default 'md'
   */
  size?: CountrySelectSize;
  /** Tailwind override hook for the outer wrapper. */
  className?: string;
  /** Tailwind override hook for the popover surface. */
  popoverClassName?: string;
}

export function CountrySelect({
  value,
  defaultValue,
  onSelectionChange,
  autoDetect = true,
  locale,
  label,
  placeholder,
  hint,
  isDisabled,
  isInvalid,
  isRequired,
  hideRequiredIndicator,
  size = 'md',
  className,
  popoverClassName,
}: CountrySelectProps) {
  const resolvedLocale = useResolvedLocale(locale);
  const items = useMemo(() => buildCountryItems(resolvedLocale), [resolvedLocale]);

  const isControlled = value !== undefined;
  const willAutoDetect = !isControlled && defaultValue === undefined && autoDetect;

  // Internal controlled state for the auto-detect path. We can't use
  // `defaultSelectedKey` for auto-detect because the detected value
  // isn't known until after the first paint (useEffect runs post-mount).
  const [internalKey, setInternalKey] = useState<string | null>(null);

  useEffect(() => {
    if (!willAutoDetect) return;
    const detected = detectBrowserCountry();
    if (detected !== null) setInternalKey(detected);
  }, [willAutoDetect]);

  const handleSelectionChange = (key: Key | null) => {
    const next = key === null ? null : String(key);
    if (willAutoDetect) setInternalKey(next);
    onSelectionChange?.(next);
  };

  // Build the ComboBox props bag conditionally — the @glaon/ui package
  // compiles with `exactOptionalPropertyTypes: true`, so passing
  // explicit `undefined` to an optional prop fails type-check.
  const comboProps: Record<string, unknown> = {
    items,
    size,
    onSelectionChange: handleSelectionChange,
    defaultFilter: diacriticInsensitiveFilter,
    shortcut: false,
  };

  if (isControlled) {
    comboProps.selectedKey = value;
  } else if (willAutoDetect) {
    comboProps.selectedKey = internalKey;
  } else if (defaultValue !== undefined) {
    comboProps.defaultSelectedKey = defaultValue;
  }

  if (label !== undefined) comboProps.label = label;
  if (placeholder !== undefined) comboProps.placeholder = placeholder;
  if (hint !== undefined) comboProps.hint = hint;
  if (isDisabled === true) comboProps.isDisabled = true;
  if (isInvalid === true) comboProps.isInvalid = true;
  if (isRequired === true) comboProps.isRequired = true;
  if (hideRequiredIndicator === true) comboProps.hideRequiredIndicator = true;
  if (className !== undefined) comboProps.className = className;
  if (popoverClassName !== undefined) comboProps.popoverClassName = popoverClassName;

  return (
    <ComboBox {...comboProps}>
      {(item: SelectItemType) => (
        <SelectItem
          id={item.id}
          label={item.label ?? ''}
          // Include the ISO code in the searchable text so users can
          // type "TR" and find Türkiye / Turkey. `item.id` is `string |
          // number` per the kit's SelectItemType — coerce explicitly so
          // template-literal restrictions don't flag the row.
          textValue={`${item.label ?? ''} ${String(item.id)}`}
        />
      )}
    </ComboBox>
  );
}

/**
 * Resolve the locale to use for country-name display + sort. Reads
 * `navigator.language` lazily so SSR builds don't crash on a missing
 * `navigator`. Falls back to `'en'` when neither prop nor navigator
 * is available.
 */
function useResolvedLocale(locale: string | undefined): string {
  return useMemo(() => {
    if (locale !== undefined && locale.length > 0) return locale;
    if (typeof navigator !== 'undefined' && navigator.language) {
      return navigator.language;
    }
    return 'en';
  }, [locale]);
}
