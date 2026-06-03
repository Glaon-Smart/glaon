// @ts-nocheck
// Kit-derived single-select with search-in-popover (#688). The Untitled
// UI free kit ships a searchable *input-trigger* select (`ComboBox`) and a
// *multi*-select popover (`MultiSelect`), but no single-select **button
// trigger + in-popover search** variant. This composes that pattern from
// the exact same react-aria-components building blocks the kit's
// `multi-select.tsx` uses (`DialogTrigger` + `Button` + `Popover` +
// `Autocomplete` + `SearchField` + `ListBox`), as single-select: a button
// trigger (leading icon + selected label + chevron) that opens a popover
// with a search field, and closes on pick. `@ts-nocheck` matches the kit
// files so an `untitledui upgrade` of the siblings stays a clean replace.
'use client';

import type { FC, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { ChevronDown, SearchLg } from '@untitledui/icons';
import type { Key, Selection } from 'react-aria-components';
import {
  Autocomplete as AriaAutocomplete,
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Input as AriaInput,
  ListBox as AriaListBox,
  Popover as AriaPopover,
  SearchField as AriaSearchField,
} from 'react-aria-components';
import { HintText } from '@/components/base/input/hint-text';
import { Label } from '@/components/base/input/label';
import { isReactComponent } from '@/utils/is-react-component';
import { cx } from '@/utils/cx';
import { SelectItem } from './select-item';
import { type CommonProps, SelectContext, type SelectItemType, sizes } from './select-shared';

const searchSizes = {
  sm: { wrapper: 'py-1', root: 'px-3 py-2 gap-2 *:data-icon:size-4 *:data-icon:stroke-[2.25px]', text: 'text-sm' },
  md: { wrapper: 'py-0.5', root: 'px-3 py-2 gap-2 *:data-icon:size-5', text: 'text-md' },
  lg: { wrapper: 'py-0.5', root: 'px-3.5 py-2.5 gap-2 *:data-icon:size-5', text: 'text-md' },
};

const popoverMaxHeights = { sm: 'max-h-68', md: 'max-h-76', lg: 'max-h-92' };

interface SearchSelectProps extends CommonProps {
  /** Options to render in the listbox. */
  items?: SelectItemType[];
  /** Row renderer (defaults to `<SelectItem>`). */
  children: ReactNode | ((item: SelectItemType) => ReactNode);
  /** Controlled selection — the selected item's key, or `null`. */
  selectedKey?: string | null;
  /** Fires with the picked key (or `null` when cleared). */
  onSelectionChange?: (key: string | null) => void;
  /** Leading icon shown in the trigger when nothing is selected. The
   *  selected item's own `icon` (e.g. a flag) takes over once picked. */
  leadingIcon?: FC | ReactNode;
  /** Diacritic-insensitive `(textValue, inputValue) => boolean` filter. */
  filter?: (textValue: string, inputValue: string) => boolean;
  /** Placeholder inside the popover search field. */
  searchPlaceholder?: string;
  /** Text shown when the search matches no option. */
  noResultsLabel?: string;
  isDisabled?: boolean;
  isRequired?: boolean;
  isInvalid?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
  popoverClassName?: string;
}

const SearchSelectRoot = ({
  items,
  children,
  size = 'md',
  selectedKey = null,
  onSelectionChange,
  leadingIcon,
  filter,
  searchPlaceholder = 'Search',
  noResultsLabel = 'No results found',
  isDisabled,
  isRequired,
  isInvalid,
  placeholder = 'Select',
  label,
  hint,
  tooltip,
  hideRequiredIndicator,
  className,
  popoverClassName,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: SearchSelectProps) => {
  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverWidth, setPopoverWidth] = useState('');

  const onResize = useCallback(() => {
    if (!triggerRef.current) return;
    setPopoverWidth(triggerRef.current.getBoundingClientRect().width + 'px');
  }, []);

  const onOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) setSearchValue('');
  };

  const handleListSelectionChange = (keys: Selection) => {
    const next = keys === 'all' ? null : ([...keys][0] as Key | undefined);
    onSelectionChange?.(next === undefined || next === null ? null : String(next));
    setIsOpen(false);
    setSearchValue('');
  };

  const selectedItem = selectedKey != null ? items?.find((i) => i.id === selectedKey) : undefined;
  const triggerIcon = selectedItem?.icon ?? leadingIcon;

  return (
    <SelectContext.Provider value={{ size }}>
      <div className={cx('flex flex-col gap-1.5', className)}>
        {label && (
          <Label
            isRequired={hideRequiredIndicator ? false : isRequired}
            isInvalid={isInvalid}
            tooltip={tooltip}
          >
            {label}
          </Label>
        )}

        <AriaDialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
          <AriaButton
            ref={triggerRef}
            isDisabled={isDisabled}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            onPress={onResize}
            className={(state) =>
              cx(
                'relative flex w-full cursor-pointer items-center rounded-lg bg-primary shadow-xs ring-1 outline-hidden transition duration-100 ease-linear ring-inset',
                isInvalid ? 'ring-error' : 'ring-primary',
                (state.isFocusVisible || state.isPressed || isOpen) && 'ring-2 ring-brand',
                state.isDisabled && 'cursor-not-allowed opacity-50',
              )
            }
          >
            <span
              className={cx(
                'flex w-full items-center truncate text-left',
                sizes[size].root,
                '*:data-icon:shrink-0 *:data-icon:text-fg-quaternary',
              )}
            >
              {isReactComponent(triggerIcon) ? (
                <triggerIcon data-icon aria-hidden="true" />
              ) : (
                (triggerIcon ?? null)
              )}

              <span className={cx('flex flex-1 truncate', sizes[size].textContainer)}>
                {selectedItem ? (
                  <span className={cx('truncate font-medium text-primary', sizes[size].text)}>
                    {selectedItem.label}
                  </span>
                ) : (
                  <span className={cx('truncate text-placeholder', sizes[size].text)}>
                    {placeholder}
                  </span>
                )}
              </span>

              <ChevronDown
                aria-hidden="true"
                className={cx(
                  'ml-auto shrink-0 text-fg-quaternary',
                  size === 'lg' ? 'size-5' : 'size-4 stroke-[2.25px]',
                )}
              />
            </span>
          </AriaButton>

          <AriaPopover
            placement="bottom"
            offset={4}
            containerPadding={0}
            style={{ width: popoverWidth || undefined }}
            className={(state) =>
              cx(
                'w-(--trigger-width) origin-(--trigger-anchor-point) overflow-hidden rounded-lg bg-primary shadow-lg ring-1 ring-secondary_alt outline-hidden will-change-transform',
                state.isEntering &&
                  'duration-150 ease-out animate-in fade-in placement-bottom:slide-in-from-top-0.5',
                state.isExiting &&
                  'duration-100 ease-in animate-out fade-out placement-bottom:slide-out-to-top-0.5',
                popoverClassName,
              )
            }
          >
            <AriaDialog className="outline-hidden">
              <AriaAutocomplete
                filter={filter}
                inputValue={searchValue}
                onInputChange={setSearchValue}
              >
                <div className={cx('border-b border-secondary', searchSizes[size].wrapper)}>
                  <AriaSearchField
                    aria-label="Search"
                    value={searchValue}
                    onChange={setSearchValue}
                    autoFocus
                  >
                    <div className={cx('flex items-center', searchSizes[size].root)}>
                      <SearchLg data-icon aria-hidden="true" className="shrink-0 text-fg-quaternary" />
                      <AriaInput
                        placeholder={searchPlaceholder}
                        className={cx(
                          'w-full appearance-none bg-transparent text-primary caret-alpha-black/90 outline-hidden placeholder:text-placeholder',
                          searchSizes[size].text,
                        )}
                      />
                    </div>
                  </AriaSearchField>
                </div>

                <AriaListBox
                  aria-label={label || ariaLabel || 'Options'}
                  items={items}
                  selectionMode="single"
                  selectedKeys={selectedKey != null ? new Set([selectedKey]) : new Set()}
                  onSelectionChange={handleListSelectionChange}
                  renderEmptyState={() => (
                    <div className="px-4 py-3 text-center text-sm text-tertiary">{noResultsLabel}</div>
                  )}
                  className={cx('overflow-y-auto py-1 outline-hidden', popoverMaxHeights[size])}
                >
                  {children}
                </AriaListBox>
              </AriaAutocomplete>
            </AriaDialog>
          </AriaPopover>
        </AriaDialogTrigger>

        {hint && (
          <HintText isInvalid={isInvalid} className={cx(size === 'sm' && 'text-xs')}>
            {hint}
          </HintText>
        )}
      </div>
    </SelectContext.Provider>
  );
};

const SearchSelect = SearchSelectRoot as typeof SearchSelectRoot & { Item: typeof SelectItem };
SearchSelect.Item = SelectItem;

export { SearchSelect };
