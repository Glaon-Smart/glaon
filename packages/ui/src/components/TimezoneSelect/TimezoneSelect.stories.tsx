import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { defineControls } from '../_internal/controls';
import { TimezoneSelect } from './TimezoneSelect';
import { timezoneSelectControls, timezoneSelectExcludeFromArgs } from './TimezoneSelect.controls';

const { args, argTypes } = defineControls(timezoneSelectControls);

// Explicit `Meta<typeof TimezoneSelect>` annotation (vs `satisfies`)
// keeps the kit's deep RAC generic chains out of the exported `meta`
// signature — `tsc --noEmit` runs with `declaration: true`.
//
// `tags: ['autodocs']` is intentionally omitted because
// `TimezoneSelect.mdx` replaces the docs tab.
const meta: Meta<typeof TimezoneSelect> = {
  title: 'App Primitives/TimezoneSelect',
  component: TimezoneSelect,
  parameters: {
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=app-primitives-timezone-select',
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
type Story = StoryObj<typeof TimezoneSelect>;

export const excludeFromArgs = timezoneSelectExcludeFromArgs;

/**
 * Default — auto-detect on. On a browser whose runtime resolves to
 * `Europe/Istanbul` the picker opens with that zone preselected.
 * The Clock glyph stays put even after a country is chosen (no
 * per-zone visual identity).
 */
export const Default: Story = {};

/**
 * Explicit `defaultValue`. The auto-detect path is skipped when the
 * host provides a default; the picker starts with the host's choice.
 */
export const WithDefaultValue: Story = {
  args: { defaultValue: 'Europe/Istanbul', autoDetect: false },
};

/**
 * Auto-detect off — the picker starts empty regardless of the
 * runtime's timezone. Use this when the host owns the state lifecycle
 * (e.g. a profile form that hydrates from the server).
 */
export const AutoDetectOff: Story = {
  args: { autoDetect: false },
};

/**
 * Common US East Coast zone — confirms the city label drops the
 * underscore (`America/New_York` renders as `New York — (UTC−04:00)`
 * or similar, depending on DST at story-load time).
 */
export const NewYork: Story = {
  args: { defaultValue: 'America/New_York', autoDetect: false },
};

/**
 * UTC — the special-case zone the formatter normalises to `(UTC)`
 * (no `±HH:MM` suffix).
 */
export const Utc: Story = {
  args: { defaultValue: 'UTC', autoDetect: false },
};

/** A seeded selection — the trigger shows the `(GMT±hh:mm) City` label. */
export const TurkishLocale: Story = {
  args: {
    autoDetect: false,
    defaultValue: 'Europe/Istanbul',
    label: 'Saat dilimi',
  },
};

/**
 * RTL render path — the decorator wraps the field in `dir="rtl"` so the
 * trigger, popover, and search-field alignment mirror correctly.
 */
export const ArabicRtl: Story = {
  args: {
    autoDetect: false,
    defaultValue: 'Asia/Riyadh',
    label: 'المنطقة الزمنية',
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
  args: { defaultValue: 'Europe/Istanbul', autoDetect: false, isDisabled: true },
};

/** Invalid + hint — error styling with descriptive copy below.
 *  Picking a zone auto-clears the styling. */
export const WithError: Story = {
  args: {
    autoDetect: false,
    isInvalid: true,
    hint: 'Timezone is required.',
  },
};

/** Helper text under the trigger when the field is valid. */
export const WithHint: Story = {
  args: {
    autoDetect: false,
    hint: 'Used for scheduling and reminders.',
  },
};

/** Size matrix — `sm`, `md`, `lg`. */
export const Sizes: Story = {
  parameters: { controls: { exclude: ['size', 'label'] } },
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <TimezoneSelect
          key={size}
          {...args}
          size={size}
          label={`Size: ${size}`}
          autoDetect={false}
          defaultValue="Europe/Istanbul"
        />
      ))}
    </div>
  ),
};
