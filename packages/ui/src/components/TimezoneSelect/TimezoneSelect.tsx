// Glaon TimezoneSelect — searchable IANA timezone picker that wraps
// the kit `<ComboBox>` (`packages/ui/src/components/base/select/combobox.tsx`).
//
// Sister primitive to `CountrySelect` — same wrap pattern, same
// state machine, same polish features (auto-clear-error,
// select-all-on-focus, diacritic-insensitive filter):
//
//   - Built-in IANA list from `Intl.supportedValuesOf('timeZone')`,
//     no shipped database, no extra dependency.
//   - Display labels combine city (last segment of the IANA id, with
//     underscores prettied) and current UTC offset
//     (`(UTC+03:00)` etc.) so users can disambiguate at a glance.
//   - Optional one-shot browser autodetection — when on, the picker
//     preselects the zone returned by
//     `Intl.DateTimeFormat().resolvedOptions().timeZone`.
//   - `Clock` glyph (`@untitledui/icons`) as the trigger leading
//     icon. Unlike CountrySelect we don't swap the icon per-zone;
//     timezones don't have a comparable visual identity.
//
// Per CLAUDE.md's UUI Source Rule and Component Data-Fetching Boundary:
// the visual + popover positioning + RAC plumbing come from the kit;
// this wrapper contributes the prop API + the dataset + detection.
// No network call lives here.

import { useCallback, useEffect, useMemo, useState, type FocusEvent, type ReactNode } from 'react';
import { Clock } from '@untitledui/icons';
import type { Key } from 'react-aria-components';

import { ComboBox, SelectItem, type SelectItemType } from '../Select';
import { buildTimezoneItems, detectBrowserTimezone, diacriticInsensitiveFilter } from './timezones';

// Types stay un-exported per memory note `feedback_knip_props_interfaces.md`
// — `react-docgen-typescript` still resolves the prop names for the
// F6 prop-coverage gate without a top-level `export`. Promote to
// `index.ts` once an external consumer needs them.
type TimezoneSelectSize = 'sm' | 'md' | 'lg';

interface TimezoneSelectProps {
  /**
   * Controlled selection — IANA timezone identifier (e.g.
   * `'Europe/Istanbul'`, `'America/New_York'`). Pair with
   * `onSelectionChange` to manage state outside. When set,
   * `defaultValue` and `autoDetect` are ignored.
   */
  value?: string;
  /**
   * Uncontrolled initial selection — IANA timezone identifier to
   * start with. When set, `autoDetect` is ignored.
   */
  defaultValue?: string;
  /**
   * Fires when the user (or the auto-detect path) changes the
   * selection. Receives the IANA identifier, or `null` when the
   * selection is cleared.
   */
  onSelectionChange?: (timezone: string | null) => void;
  /**
   * When `true` (default), pre-select the timezone returned by
   * `Intl.DateTimeFormat().resolvedOptions().timeZone` on mount.
   * Ignored when `value` or `defaultValue` is set. Detection is
   * one-shot — re-mount to re-detect.
   * @default true
   */
  autoDetect?: boolean;
  /**
   * BCP-47 locale tag used to sort city labels. Defaults to
   * `navigator.language` in the browser, `'en'` on a runtime without
   * `navigator` (e.g. SSR). The city labels themselves stay in
   * English (the IANA database is English); only the sort order
   * follows the locale's collation rules.
   */
  locale?: string;
  /** Field label rendered above the trigger. */
  label?: string;
  /** Accessible name when no visible `label` is rendered. Forwarded to
   *  the underlying ComboBox. */
  'aria-label'?: string;
  /** Id of an external visible label; forwarded as `aria-labelledby` to
   *  associate a host-rendered label instead of the built-in `label`. */
  'aria-labelledby'?: string;
  /** Placeholder text shown when no option is selected. */
  placeholder?: string;
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
  size?: TimezoneSelectSize;
  /** Tailwind override hook for the outer wrapper. */
  className?: string;
  /** Tailwind override hook for the popover surface. */
  popoverClassName?: string;
}

export function TimezoneSelect({
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
}: TimezoneSelectProps) {
  const resolvedLocale = useResolvedLocale(locale);
  const items = useMemo(() => buildTimezoneItems(resolvedLocale), [resolvedLocale]);

  const isHostControlled = value !== undefined;

  // Unified selection state — seeded from `defaultValue`; auto-detect
  // promotes the seed when neither `value` nor `defaultValue` is set.
  // Same shape as CountrySelect so the wrap pattern stays consistent
  // across the sister pair.
  const [internalKey, setInternalKey] = useState<string | null>(defaultValue ?? null);

  useEffect(() => {
    if (isHostControlled) return;
    if (defaultValue !== undefined) return;
    if (!autoDetect) return;
    const detected = detectBrowserTimezone();
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

  const handleSelectionChange = (key: Key | null) => {
    const next = key === null ? null : String(key);
    if (!isHostControlled) setInternalKey(next);
    setSuppressInvalid(true);
    onSelectionChange?.(next);
  };

  // Select-all-on-focus inside the inner search input so the next
  // keystroke replaces the previous label cleanly. RAC's ComboBox
  // doesn't forward `onFocus` to the input, so we capture at the
  // wrapper and act on any input descendant. `requestAnimationFrame`
  // defers the `.select()` until RAC's own focus handling settles.
  const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.disabled || target.readOnly) return;
    requestAnimationFrame(() => {
      try {
        target.select();
      } catch {
        // Input may have unmounted between the focus event and the
        // rAF tick — the failed `.select()` is harmless.
      }
    });
  }, []);

  const effectiveInvalid = isInvalid === true && !suppressInvalid;

  // Build the ComboBox props bag conditionally — the @glaon/ui package
  // compiles with `exactOptionalPropertyTypes: true`, so passing
  // explicit `undefined` to an optional prop fails type-check.
  const comboProps: Record<string, unknown> = {
    items,
    size,
    selectedKey: effectiveKey ?? null,
    onSelectionChange: handleSelectionChange,
    defaultFilter: diacriticInsensitiveFilter,
    shortcut: false,
    icon: Clock,
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
 * Resolve the locale to use for the timezone collator. Reads
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
