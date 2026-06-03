import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { defineControls } from '../_internal/controls';
import { CountrySelect } from './CountrySelect';
import { countrySelectControls, countrySelectExcludeFromArgs } from './CountrySelect.controls';

const { args, argTypes } = defineControls(countrySelectControls);

// Explicit `Meta<typeof CountrySelect>` annotation (vs `satisfies`)
// keeps the kit's deep RAC generic chains out of the exported `meta`
// signature — `tsc --noEmit` runs with `declaration: true`.
//
// `tags: ['autodocs']` is intentionally omitted because
// `CountrySelect.mdx` replaces the docs tab.
const meta: Meta<typeof CountrySelect> = {
  title: 'App Primitives/CountrySelect',
  component: CountrySelect,
  parameters: {
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=app-primitives-country-select',
    },
  },
  args,
  argTypes,
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof CountrySelect>;

export const excludeFromArgs = countrySelectExcludeFromArgs;

/**
 * Default — auto-detect on. On a browser with `navigator.language =
 * 'tr-TR'` the picker opens with Türkiye preselected. Clear the
 * selection or pick something else to override.
 */
export const Default: Story = {};

/**
 * Explicit `defaultValue`. The auto-detect path is skipped when the
 * host provides a default; the picker starts with the host's choice.
 */
export const WithDefaultValue: Story = {
  args: { defaultValue: 'TR', autoDetect: false },
};

/**
 * Auto-detect off — the picker starts empty regardless of the
 * browser's locale. Use this when the host owns the state lifecycle
 * (e.g. a profile form that hydrates from the server).
 */
export const AutoDetectOff: Story = {
  args: { autoDetect: false },
};

/**
 * Turkish locale — names render as "Türkiye / Almanya / Birleşik
 * Krallık" and sort with `Intl.Collator('tr')` so "Çekya" comes after
 * "Ç" and not after "C".
 */
export const TurkishLocale: Story = {
  args: { locale: 'tr-TR', autoDetect: false, defaultValue: 'TR', label: 'Ülke' },
};

/**
 * German locale — same dataset, different rendered names ("Türkei",
 * "Vereinigte Staaten").
 */
export const GermanLocale: Story = {
  args: { locale: 'de-DE', autoDetect: false, defaultValue: 'DE', label: 'Land' },
};

/**
 * Arabic locale — exercises the RTL render path. The decorator wraps
 * the field in `dir="rtl"` so the trigger, popover, and search-field
 * alignment mirror correctly.
 */
export const ArabicRtl: Story = {
  args: { locale: 'ar-SA', autoDetect: false, defaultValue: 'SA', label: 'الدولة' },
  decorators: [
    (Story) => (
      <div dir="rtl" style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};

/** Disabled — trigger is dimmed, popover does not open. */
export const Disabled: Story = {
  args: { defaultValue: 'TR', autoDetect: false, isDisabled: true },
};

/** Invalid + hint — error styling with descriptive copy below. */
export const WithError: Story = {
  args: {
    autoDetect: false,
    isInvalid: true,
    hint: 'Country is required.',
  },
};

/** Helper text under the trigger when the field is valid. */
export const WithHint: Story = {
  args: {
    autoDetect: false,
    hint: 'Select your billing country.',
  },
};

/** Size matrix — `sm`, `md`, `lg`. */
export const Sizes: Story = {
  parameters: { controls: { exclude: ['size', 'label'] } },
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <CountrySelect
          key={size}
          {...args}
          size={size}
          label={`Size: ${size}`}
          autoDetect={false}
          defaultValue="TR"
        />
      ))}
    </div>
  ),
};
