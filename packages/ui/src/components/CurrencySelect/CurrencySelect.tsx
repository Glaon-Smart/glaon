// Glaon CurrencySelect — searchable ISO 4217 currency picker that wraps
// the kit `<SearchSelect>` (button trigger + in-popover search), the same
// primitive CountrySelect uses (#688).
//
// Sister primitive to `CountrySelect` / `TimezoneSelect` — same wrap
// pattern, same state machine, same polish (auto-clear-error,
// diacritic-insensitive filter):
//
//   - Built-in list from `Intl.supportedValuesOf('currency')`, no shipped
//     database, no extra dependency.
//   - Rows + trigger show the **flag + ISO 4217 code only** (e.g. 🇹🇷 TRY).
//     The localized currency *name* is dropped on purpose — it's
//     locale-dependent and reads as noise in a multi-language wizard.
//   - Optional one-shot autodetection from the browser locale's region
//     (`Intl.Locale.getCurrencies()`).
//   - `Coins01` glyph (`@untitledui/icons`) as the placeholder trigger icon
//     until a currency is picked.
//
// Per CLAUDE.md's UUI Source Rule + Component Data-Fetching Boundary: the
// visual + popover + RAC plumbing come from the kit; this wrapper adds the
// prop API + dataset + detection. No network call here.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Coins01 } from '@untitledui/icons';

import { Flag } from '../../icons/flag';
import { SearchSelect, SelectItem, type SelectItemType } from '../Select';
import {
  buildCurrencyItems,
  currencyFlagCode,
  detectBrowserCurrency,
  diacriticInsensitiveFilter,
} from './currencies';

// Types stay un-exported per memory note `feedback_knip_props_interfaces.md`.
type CurrencySelectSize = 'sm' | 'md' | 'lg';

interface CurrencySelectProps {
  /**
   * Controlled selection — ISO 4217 code (e.g. `'TRY'`, `'USD'`). Pair
   * with `onSelectionChange`. When set, `defaultValue` + `autoDetect` are
   * ignored.
   */
  value?: string;
  /** Uncontrolled initial selection — ISO 4217 code. Ignores `autoDetect`. */
  defaultValue?: string;
  /** Fires on selection change. Receives the ISO 4217 code, or `null`. */
  onSelectionChange?: (currency: string | null) => void;
  /**
   * When `true` (default), preselect the currency of the browser locale's
   * region on mount. Ignored when `value` / `defaultValue` is set.
   * One-shot — re-mount to re-detect. @default true
   */
  autoDetect?: boolean;
  /** Field label rendered above the trigger. */
  label?: string;
  /** Accessible name when no visible `label` is rendered; forwarded to
   *  the SearchSelect. */
  'aria-label'?: string;
  /** Id of an external visible label; forwarded as `aria-labelledby`. */
  'aria-labelledby'?: string;
  /** Placeholder shown in the (closed) trigger when nothing is selected. */
  placeholder?: string;
  /** Placeholder inside the in-popover search field. @default 'Search' */
  searchPlaceholder?: string;
  /** Text shown when the search matches no currency. @default 'No results found' */
  noResultsLabel?: string;
  /** Helper text under the trigger; doubles as the error message when
   *  `isInvalid` is true. */
  hint?: ReactNode;
  /** Block all interaction and dim the trigger. */
  isDisabled?: boolean;
  /** Surface validation error styling. Auto-clears on selection. */
  isInvalid?: boolean;
  /** Mark the field as required. */
  isRequired?: boolean;
  /** Hide the visual `*` even when `isRequired` is true. */
  hideRequiredIndicator?: boolean;
  /** Visual scale of the underlying ComboBox. @default 'md' */
  size?: CurrencySelectSize;
  /** Tailwind override hook for the outer wrapper. */
  className?: string;
  /** Tailwind override hook for the popover surface. */
  popoverClassName?: string;
}

export function CurrencySelect({
  value,
  defaultValue,
  onSelectionChange,
  autoDetect = true,
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
}: CurrencySelectProps) {
  // Each item carries its flag as `icon` so the SearchSelect trigger shows
  // the selected currency's flag and every popover row shows its flag.
  const items = useMemo(
    () =>
      buildCurrencyItems().map((item) => ({
        ...item,
        icon: renderListItemFlag(currencyFlagCode(String(item.id))),
      })),
    [],
  );

  const isHostControlled = value !== undefined;
  const [internalKey, setInternalKey] = useState<string | null>(defaultValue ?? null);

  useEffect(() => {
    if (isHostControlled) return;
    if (defaultValue !== undefined) return;
    if (!autoDetect) return;
    const detected = detectBrowserCurrency();
    if (detected !== null) setInternalKey(detected);
    // One-shot mount detection — explicit empty dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveKey = isHostControlled ? value : internalKey;

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

  // Build the SearchSelect props bag conditionally — @glaon/ui compiles with
  // `exactOptionalPropertyTypes: true`, so explicit `undefined` fails.
  const selectProps: Record<string, unknown> = {
    items,
    size,
    selectedKey: effectiveKey ?? null,
    onSelectionChange: handleSelectionChange,
    filter: diacriticInsensitiveFilter,
    // Coins placeholder glyph until a currency is picked; once selected the
    // SearchSelect trigger shows that currency's flag (the item's `icon`).
    leadingIcon: Coins01,
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
 * Per-row flag for each currency (popover rows + the selected trigger).
 * Pre-tagged `<span data-icon>` so the kit's `*:data-icon:size-5` selector
 * on the container pulls the sizing + colour utilities through. Mirrors
 * CountrySelect's `renderListItemFlag`.
 */
function renderListItemFlag(code: string): ReactNode {
  return (
    <span data-icon className="flex shrink-0 items-center" aria-hidden="true">
      <Flag country={code} shape="square" />
    </span>
  );
}
