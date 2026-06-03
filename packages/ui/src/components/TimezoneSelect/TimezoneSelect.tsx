// Glaon TimezoneSelect — timezone picker. The option list + labels come
// from `react-timezone-select`'s `useTimezoneSelect` hook (#690): a curated
// set with DST-aware `(GMT±hh:mm) City` labels. The UI is our UUI
// `SearchSelect` (button trigger + in-popover search, #688) — same look as
// CountrySelect, no `react-select` (hook-only).
//
// Sister primitive to `CountrySelect`: same wrap pattern + state machine
// (auto-clear-error, diacritic-insensitive filter, one-shot browser
// auto-detection). The emitted value is the IANA id (`Europe/Istanbul`).
//
// Per CLAUDE.md's UUI Source Rule + Component Data-Fetching Boundary: the
// trigger + popover + search come from the kit `SearchSelect`; this wrapper
// contributes the prop API + the hook-sourced dataset + detection. No
// network call here.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock } from '@untitledui/icons';
import { allTimezones, useTimezoneSelect } from 'react-timezone-select';

import { SearchSelect, SelectItem, type SelectItemType } from '../Select';
import { detectBrowserTimezone, diacriticInsensitiveFilter } from './timezones';

// Types stay un-exported per memory note `feedback_knip_props_interfaces.md`.
type TimezoneSelectSize = 'sm' | 'md' | 'lg';

interface TimezoneSelectProps {
  /**
   * Controlled selection — IANA timezone identifier (e.g.
   * `'Europe/Istanbul'`). Pair with `onSelectionChange`. When set,
   * `defaultValue` and `autoDetect` are ignored.
   */
  value?: string;
  /** Uncontrolled initial selection — IANA id. Ignores `autoDetect`. */
  defaultValue?: string;
  /** Fires on selection change. Receives the IANA id, or `null`. */
  onSelectionChange?: (timezone: string | null) => void;
  /**
   * When `true` (default), pre-select the timezone returned by
   * `Intl.DateTimeFormat().resolvedOptions().timeZone` on mount. Ignored
   * when `value` / `defaultValue` is set. One-shot. @default true
   */
  autoDetect?: boolean;
  /** Field label rendered above the trigger. */
  label?: string;
  /** Accessible name when no visible `label` is rendered. */
  'aria-label'?: string;
  /** Id of an external visible label; forwarded as `aria-labelledby`. */
  'aria-labelledby'?: string;
  /** Placeholder shown in the (closed) trigger when nothing is selected. */
  placeholder?: string;
  /** Placeholder inside the in-popover search field. @default 'Search' */
  searchPlaceholder?: string;
  /** Text shown when the search matches no zone. @default 'No results found' */
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
  /** Visual scale of the underlying SearchSelect. @default 'md' */
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
}: TimezoneSelectProps) {
  // DST-aware timezone options from react-timezone-select's curated
  // `allTimezones` set: one row per GMT offset with a multi-city label, e.g.
  // `(GMT+3:00) Istanbul, Minsk, Moscow, St. Petersburg, Volgograd`. This is
  // the deliberately compact, offset-grouped presentation (~79 rows) rather
  // than the full IANA list. `value` is the curated representative IANA id.
  const { options, parseTimezone } = useTimezoneSelect({
    labelStyle: 'original',
    timezones: allTimezones,
  });
  const items = useMemo<SelectItemType[]>(
    () => options.map((o) => ({ id: o.value, label: o.label })),
    [options],
  );

  const isHostControlled = value !== undefined;
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

  // The curated list keys one row per offset (e.g. the GMT+3 row's id is
  // `Europe/Moscow`), so a seeded id that isn't a curated key — like
  // `Europe/Istanbul` from the country→timezone sync — wouldn't match any
  // row and the trigger would render blank. `parseTimezone` fuzzy-resolves
  // any IANA id to its curated row, so we resolve the *displayed* key only.
  // The held value (`effectiveKey`) stays untouched: we never rewrite the
  // seeded id to the curated representative — that only happens when the
  // user actively picks a row (via `handleSelectionChange`).
  const displayKey = useMemo<string | null>(() => {
    if (effectiveKey == null) return null;
    if (items.some((i) => i.id === effectiveKey)) return effectiveKey;
    // react-timezone-select types `parseTimezone` as always returning an
    // option, but at runtime it returns `false` for an unrecognised id that
    // has no "/" — widen to the real contract so the guard is legitimate.
    const resolved = parseTimezone(effectiveKey) as { value: string } | string | false;
    return resolved && typeof resolved === 'object' ? resolved.value : effectiveKey;
  }, [effectiveKey, items, parseTimezone]);

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
    selectedKey: displayKey,
    onSelectionChange: handleSelectionChange,
    filter: diacriticInsensitiveFilter,
    leadingIcon: Clock,
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
      {(item: SelectItemType) => <SelectItem id={item.id} label={item.label ?? ''} />}
    </SearchSelect>
  );
}
