// Glaon CurrencySelect — searchable ISO 4217 currency picker that wraps
// the kit `<ComboBox>` (`packages/ui/src/components/base/select/combobox.tsx`).
//
// Sister primitive to `CountrySelect` / `TimezoneSelect` — same wrap
// pattern, same state machine, same polish (auto-clear-error,
// select-all-on-focus, diacritic-insensitive filter):
//
//   - Built-in list from `Intl.supportedValuesOf('currency')`, no shipped
//     database, no extra dependency.
//   - Labels combine the code + localized currency name
//     (`'TRY — Turkish Lira'`) via `Intl.DisplayNames`.
//   - Optional one-shot autodetection from the browser locale's region
//     (`Intl.Locale.getCurrencies()`).
//   - `Coins01` glyph (`@untitledui/icons`) as the trigger leading icon.
//
// Per CLAUDE.md's UUI Source Rule + Component Data-Fetching Boundary: the
// visual + popover + RAC plumbing come from the kit; this wrapper adds the
// prop API + dataset + detection. No network call here.

import { useCallback, useEffect, useMemo, useState, type FocusEvent, type ReactNode } from 'react';
import { Coins01 } from '@untitledui/icons';
import type { Key } from 'react-aria-components';

import { ComboBox, SelectItem, type SelectItemType } from '../Select';
import {
  buildCurrencyItems,
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
  /** BCP-47 locale used for currency names + label collation. */
  locale?: string;
  /** Field label rendered above the trigger. */
  label?: string;
  /** Accessible name when no visible `label` is rendered; forwarded to
   *  the ComboBox. */
  'aria-label'?: string;
  /** Id of an external visible label; forwarded as `aria-labelledby`. */
  'aria-labelledby'?: string;
  /** Placeholder text shown when no option is selected. */
  placeholder?: string;
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
  locale,
  label,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  placeholder,
  hint,
  isDisabled,
  isInvalid,
  isRequired,
  hideRequiredIndicator,
  size = 'md',
  className,
  popoverClassName,
}: CurrencySelectProps) {
  const resolvedLocale = useResolvedLocale(locale);
  const items = useMemo(() => buildCurrencyItems(resolvedLocale), [resolvedLocale]);

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

  const handleSelectionChange = (key: Key | null) => {
    const next = key === null ? null : String(key);
    if (!isHostControlled) setInternalKey(next);
    setSuppressInvalid(true);
    onSelectionChange?.(next);
  };

  const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.disabled || target.readOnly) return;
    requestAnimationFrame(() => {
      try {
        target.select();
      } catch {
        // Input may have unmounted between the focus event and the rAF tick.
      }
    });
  }, []);

  const effectiveInvalid = isInvalid === true && !suppressInvalid;

  const comboProps: Record<string, unknown> = {
    items,
    size,
    selectedKey: effectiveKey ?? null,
    onSelectionChange: handleSelectionChange,
    defaultFilter: diacriticInsensitiveFilter,
    shortcut: false,
    icon: Coins01,
  };

  if (label !== undefined) comboProps.label = label;
  if (ariaLabel !== undefined) comboProps['aria-label'] = ariaLabel;
  if (ariaLabelledby !== undefined) comboProps['aria-labelledby'] = ariaLabelledby;
  if (placeholder !== undefined) comboProps.placeholder = placeholder;
  if (hint !== undefined) comboProps.hint = hint;
  if (isDisabled === true) comboProps.isDisabled = true;
  if (effectiveInvalid) comboProps.isInvalid = true;
  if (isRequired === true) comboProps.isRequired = true;
  if (hideRequiredIndicator === true) comboProps.hideRequiredIndicator = true;
  if (className !== undefined) comboProps.className = className;
  if (popoverClassName !== undefined) comboProps.popoverClassName = popoverClassName;

  return (
    <div onFocusCapture={handleFocusCapture}>
      <ComboBox {...comboProps}>
        {(item: SelectItemType) => <SelectItem id={item.id} label={item.label ?? ''} />}
      </ComboBox>
    </div>
  );
}

/**
 * Resolve the locale for currency names + collation. Reads
 * `navigator.language` lazily so SSR builds don't crash on a missing
 * `navigator`. Falls back to `'en'`.
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
