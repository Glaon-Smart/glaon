import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { defineControls } from '../_internal/controls';
import { CurrencySelect } from './CurrencySelect';
import { currencySelectControls, currencySelectExcludeFromArgs } from './CurrencySelect.controls';

const { args, argTypes } = defineControls(currencySelectControls);

// Explicit `Meta<typeof CurrencySelect>` annotation (vs `satisfies`)
// keeps the kit's deep RAC generic chains out of the exported `meta`
// signature — `tsc --noEmit` runs with `declaration: true`.
//
// `tags: ['autodocs']` omitted because `CurrencySelect.mdx` replaces the
// docs tab.
const meta: Meta<typeof CurrencySelect> = {
  title: 'App Primitives/CurrencySelect',
  component: CurrencySelect,
  parameters: {
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=app-primitives-currency-select',
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
type Story = StoryObj<typeof CurrencySelect>;

export const excludeFromArgs = currencySelectExcludeFromArgs;

/**
 * Default — auto-detect on. On a browser whose locale region resolves to
 * a currency (e.g. `tr-TR` → `TRY`) the picker opens with it preselected.
 */
export const Default: Story = {};

/**
 * Explicit `defaultValue`. The auto-detect path is skipped when the host
 * provides a default; the picker starts with the host's choice.
 */
export const WithDefaultValue: Story = {
  args: { defaultValue: 'TRY', autoDetect: false },
};

/**
 * Auto-detect off — the picker starts empty regardless of the runtime's
 * region. Use when the host owns the state lifecycle (e.g. a form that
 * hydrates from the server).
 */
export const AutoDetectOff: Story = {
  args: { autoDetect: false },
};

/** US Dollar — the most common reserve currency. */
export const UsDollar: Story = {
  args: { defaultValue: 'USD', autoDetect: false },
};

/**
 * Localized field label — the rows still show the code + flag only
 * (`TRY` 🇹🇷); only the field's own `label` is translated by the host.
 */
export const TurkishLocale: Story = {
  args: {
    autoDetect: false,
    defaultValue: 'TRY',
    label: 'Para birimi',
  },
};

/**
 * RTL render path — the decorator wraps the field in `dir="rtl"` so the
 * popover + alignment mirror correctly. Rows stay code + flag.
 */
export const ArabicRtl: Story = {
  args: {
    autoDetect: false,
    defaultValue: 'SAR',
    label: 'العملة',
  },
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
  args: { defaultValue: 'EUR', autoDetect: false, isDisabled: true },
};

/** Invalid + hint — error styling with descriptive copy below. Picking a
 *  currency auto-clears the styling. */
export const WithError: Story = {
  args: {
    autoDetect: false,
    isInvalid: true,
    hint: 'Currency is required.',
  },
};

/** Helper text under the trigger when the field is valid. */
export const WithHint: Story = {
  args: {
    autoDetect: false,
    hint: 'Used for energy-cost and billing displays.',
  },
};

/** Size matrix — `sm`, `md`, `lg`. */
export const Sizes: Story = {
  parameters: { controls: { exclude: ['size', 'label'] } },
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <CurrencySelect
          key={size}
          {...args}
          size={size}
          label={`Size: ${size}`}
          autoDetect={false}
          defaultValue="TRY"
        />
      ))}
    </div>
  ),
};
