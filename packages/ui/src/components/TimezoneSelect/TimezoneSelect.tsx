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
import { buildTimezoneDict, detectBrowserTimezone, diacriticInsensitiveFilter } from './timezones';

// react-timezone-select labels are `(GMT±hh:mm) City`. Many IANA zones share
// an offset, so we group them under a `GMT±hh:mm` section header and show
// just the city per row — the full label is kept as the trigger value and as
// the search `textValue`, so typing "gmt+3" or "istanbul" both match.
const GMT_PREFIX_RE = /^\(([^)]*)\)\s*/;

function offsetGroup(item: SelectItemType): string {
  return GMT_PREFIX_RE.exec(item.label ?? '')?.[1] ?? 'Other';
}

function cityLabel(label: string): string {
  return label.replace(GMT_PREFIX_RE, '') || label;
}

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
  // DST-aware timezone options from react-timezone-select, over the FULL
  // runtime IANA list (so every zone the wizard may seed/sync — e.g.
  // Europe/Istanbul — is present; the library's curated `allTimezones`
  // omits many). Falls back to `allTimezones` if `supportedValuesOf` is
  // unavailable. `value` is the IANA id; `label` is `(GMT±hh:mm) City`.
  const timezoneDict = useMemo(() => {
    const full = buildTimezoneDict();
    return Object.keys(full).length > 0 ? full : allTimezones;
  }, []);
  const { options } = useTimezoneSelect({ labelStyle: 'original', timezones: timezoneDict });
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
    leadingIcon: Clock,
    groupBy: offsetGroup,
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
        <SelectItem id={item.id} label={cityLabel(item.label ?? '')} textValue={item.label ?? ''} />
      )}
    </SearchSelect>
  );
}
