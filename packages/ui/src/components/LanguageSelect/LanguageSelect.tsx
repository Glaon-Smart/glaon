// Glaon LanguageSelect — language picker that wraps the kit `<Select>`
// (icon-leading variant). Sister to CountrySelect / TimezoneSelect /
// CurrencySelect, but a plain dropdown (no in-field search, #683): the
// candidate languages are *injected* via `options` (the HA-supported set
// the app reads from the device), and each label is the language's autonym
// followed by its name in the current locale (`Deutsch — Almanca`).
//
// Per CLAUDE.md's UUI Source Rule + Component Data-Fetching Boundary: the
// visual + popover + RAC plumbing come from the kit `Select`; this wrapper
// adds the prop API + label derivation + one-shot browser detection. No
// network call here.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Translate01 } from '@untitledui/icons';
import type { Key } from 'react-aria-components';

import { Select, SelectItem, type SelectItemType } from '../Select';
import { buildLanguageItems, detectBrowserLanguage } from './languages';

// Types stay un-exported per memory note `feedback_knip_props_interfaces.md`.
type LanguageSelectSize = 'sm' | 'md' | 'lg';

interface LanguageSelectProps {
  /**
   * Supported language codes (BCP-47, e.g. `['en','tr','de']`). The app
   * injects its set (from the device seed); when empty a common fallback
   * list renders so the primitive works in isolation.
   */
  options?: readonly string[];
  /** Controlled selection — a language code from `options`. */
  value?: string;
  /** Uncontrolled initial selection. Ignores `autoDetect`. */
  defaultValue?: string;
  /** Fires on selection change. Receives the code, or `null`. */
  onSelectionChange?: (language: string | null) => void;
  /**
   * When `true` (default), preselect the browser's language on mount if it
   * is one of `options`. Ignored when `value` / `defaultValue` is set.
   * One-shot. @default true
   */
  autoDetect?: boolean;
  /** BCP-47 locale used for the language names + label collation. */
  locale?: string;
  /** Field label rendered above the trigger. */
  label?: string;
  /** Accessible name when no visible `label` is rendered; forwarded to
   *  the Select. */
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
  /** Visual scale of the underlying Select. @default 'md' */
  size?: LanguageSelectSize;
  /** Tailwind override hook for the outer wrapper. */
  className?: string;
  /** Tailwind override hook for the popover surface. */
  popoverClassName?: string;
}

export function LanguageSelect({
  options = [],
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
}: LanguageSelectProps) {
  const resolvedLocale = useResolvedLocale(locale);
  const items = useMemo(
    () => buildLanguageItems(options, resolvedLocale),
    [options, resolvedLocale],
  );

  const isHostControlled = value !== undefined;
  const [internalKey, setInternalKey] = useState<string | null>(defaultValue ?? null);

  useEffect(() => {
    if (isHostControlled) return;
    if (defaultValue !== undefined) return;
    if (!autoDetect) return;
    const detected = detectBrowserLanguage(options);
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

  const effectiveInvalid = isInvalid === true && !suppressInvalid;

  // Build the Select props bag conditionally — @glaon/ui compiles with
  // `exactOptionalPropertyTypes`, so passing explicit `undefined` to an
  // optional prop fails type-check.
  const selectProps: Record<string, unknown> = {
    items,
    size,
    selectedKey: effectiveKey ?? null,
    onSelectionChange: handleSelectionChange,
    icon: Translate01,
  };

  if (label !== undefined) selectProps.label = label;
  if (ariaLabel !== undefined) selectProps['aria-label'] = ariaLabel;
  if (ariaLabelledby !== undefined) selectProps['aria-labelledby'] = ariaLabelledby;
  if (placeholder !== undefined) selectProps.placeholder = placeholder;
  if (hint !== undefined) selectProps.hint = hint;
  if (isDisabled === true) selectProps.isDisabled = true;
  if (effectiveInvalid) selectProps.isInvalid = true;
  if (isRequired === true) selectProps.isRequired = true;
  if (hideRequiredIndicator === true) selectProps.hideRequiredIndicator = true;
  if (className !== undefined) selectProps.className = className;
  if (popoverClassName !== undefined) selectProps.popoverClassName = popoverClassName;

  return (
    <Select {...selectProps}>
      {(item: SelectItemType) => <SelectItem id={item.id} label={item.label ?? ''} />}
    </Select>
  );
}

/**
 * Resolve the locale for language names + collation. Reads
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
