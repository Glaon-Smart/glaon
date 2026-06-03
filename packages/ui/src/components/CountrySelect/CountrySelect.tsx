// Glaon CountrySelect — searchable country picker that wraps the
// kit `<ComboBox>` (`packages/ui/src/components/base/select/combobox.tsx`).
//
// Domain logic this wrapper adds on top of the kit ComboBox:
//
//   - Bundled ISO 3166-1 alpha-2 list, localized at render time via
//     `Intl.DisplayNames` — no shipped translation tables, no dep.
//   - Diacritic-insensitive search (`turkiye` → `Türkiye`, `reunion`
//     → `Réunion`).
//   - Optional one-shot browser locale auto-detection — when on, the
//     picker preselects the user's country derived from
//     `navigator.language` / `navigator.languages`. Pure browser API,
//     no network call.
//   - Flag glyphs (rounded sprite from `flag-icons`) in every list
//     row and in the trigger once a country is selected. A `Globe`
//     glyph stands in until the first selection.
//   - Errors clear after the user picks a country. The host can
//     re-assert `isInvalid` (toggle false → true) to force the error
//     back when re-validation rejects the new value.
//   - Select-all-on-focus inside the input so the next keystroke
//     replaces the previous selection cleanly.
//
// Per CLAUDE.md's UUI Source Rule and Component Data-Fetching Boundary:
// the visual + popover positioning + RAC plumbing come from the kit;
// this wrapper's contribution is the prop API + the static country
// list + locale detection. No network call lives here.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Globe01 } from '@untitledui/icons';

import { Flag } from '../../icons/flag';
import { SearchSelect, SelectItem, type SelectItemType } from '../Select';
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
  /**
   * Accessible name when no visible `label` is rendered (e.g. the host
   * supplies its own external label). Forwarded to the underlying
   * ComboBox so the control still has an accessible name for AT.
   */
  'aria-label'?: string;
  /**
   * Id of an external visible label element. Forwarded to the ComboBox
   * as `aria-labelledby` — use this to associate a host-rendered label
   * (e.g. a form row) instead of the built-in `label`.
   */
  'aria-labelledby'?: string;
  /** Placeholder text shown in the (closed) trigger when nothing is selected. */
  placeholder?: string;
  /** Placeholder inside the in-popover search field. @default 'Search' */
  searchPlaceholder?: string;
  /** Text shown when the search matches no country. @default 'No results found' */
  noResultsLabel?: string;
  /** Helper text shown under the trigger; doubles as the error
   *  message when `isInvalid` is true. */
  hint?: ReactNode;
  /** Block all interaction and dim the trigger. */
  isDisabled?: boolean;
  /**
   * Surface validation error styling. Pair with `hint` to describe
   * the error; the kit wires `aria-invalid` + `aria-describedby`.
   *
   * The picker auto-clears this styling once the user makes a
   * selection — the host can re-assert it by toggling `isInvalid`
   * from `false` → `true` after re-validation.
   */
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
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  placeholder,
  searchPlaceholder,
  noResultsLabel,
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
  // Each item carries its flag as `icon` so the SearchSelect trigger shows
  // the selected country's flag and every popover row shows its flag.
  const items = useMemo(
    () =>
      buildCountryItems(resolvedLocale).map((item) => ({
        ...item,
        icon: renderListItemFlag(String(item.id)),
      })),
    [resolvedLocale],
  );

  const isHostControlled = value !== undefined;

  // Unified selection state — held by the wrapper so the trigger
  // can render the selected country's flag in every mode (the kit's
  // ComboBoxStateContext is only readable from inside the ComboBox).
  // Seeded from `defaultValue`; auto-detect (in the useEffect below)
  // promotes the seed when neither `value` nor `defaultValue` is set.
  const [internalKey, setInternalKey] = useState<string | null>(defaultValue ?? null);

  useEffect(() => {
    if (isHostControlled) return;
    if (defaultValue !== undefined) return;
    if (!autoDetect) return;
    const detected = detectBrowserCountry();
    if (detected !== null) setInternalKey(detected);
    // One-shot mount detection — explicit empty dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveKey = isHostControlled ? value : internalKey;

  // Suppress the invalid styling once the user picks something. The
  // host can re-assert `isInvalid` by toggling it false → true (the
  // effect below resets the suppression when the prop transitions).
  const [suppressInvalid, setSuppressInvalid] = useState(false);
  useEffect(() => {
    setSuppressInvalid(false);
  }, [isInvalid]);

  const handleSelectionChange = (next: string | null) => {
    if (!isHostControlled) setInternalKey(next);
    setSuppressInvalid(true);
    onSelectionChange?.(next);
  };

  const effectiveInvalid = isInvalid === true && !suppressInvalid;

  // Build the SearchSelect props bag conditionally — the @glaon/ui package
  // compiles with `exactOptionalPropertyTypes: true`, so passing explicit
  // `undefined` to an optional prop fails type-check.
  const selectProps: Record<string, unknown> = {
    items,
    size,
    selectedKey: effectiveKey ?? null,
    onSelectionChange: handleSelectionChange,
    filter: diacriticInsensitiveFilter,
    // Globe placeholder glyph until a country is picked; once selected the
    // SearchSelect trigger shows that country's flag (the item's `icon`).
    leadingIcon: Globe01,
  };

  if (label !== undefined) selectProps.label = label;
  if (ariaLabel !== undefined) selectProps['aria-label'] = ariaLabel;
  if (ariaLabelledby !== undefined) selectProps['aria-labelledby'] = ariaLabelledby;
  if (placeholder !== undefined) selectProps.placeholder = placeholder;
  if (searchPlaceholder !== undefined) selectProps.searchPlaceholder = searchPlaceholder;
  if (noResultsLabel !== undefined) selectProps.noResultsLabel = noResultsLabel;
  if (hint !== undefined) selectProps.hint = hint;
  if (isDisabled === true) selectProps.isDisabled = true;
  if (effectiveInvalid) selectProps.isInvalid = true;
  if (isRequired === true) selectProps.isRequired = true;
  if (hideRequiredIndicator === true) selectProps.hideRequiredIndicator = true;
  if (className !== undefined) selectProps.className = className;
  if (popoverClassName !== undefined) selectProps.popoverClassName = popoverClassName;

  return (
    <SearchSelect {...selectProps}>
      {(item: SelectItemType) => (
        <SelectItem id={item.id} label={item.label ?? ''} icon={item.icon} />
      )}
    </SearchSelect>
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

/**
 * Per-row flag for each country (popover rows + the selected trigger).
 * Pre-tagged `<span data-icon>` so the kit's `*:data-icon:size-5` selector
 * on the container pulls the sizing + colour utilities through.
 */
function renderListItemFlag(code: string): ReactNode {
  return (
    <span data-icon className="flex shrink-0 items-center" aria-hidden="true">
      <Flag country={code} shape="square" />
    </span>
  );
}
