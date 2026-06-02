import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { defineControls } from '../_internal/controls';
import { LanguageSelect } from './LanguageSelect';
import { languageSelectControls, languageSelectExcludeFromArgs } from './LanguageSelect.controls';

const { args, argTypes } = defineControls(languageSelectControls);

// Glaon ships en/tr today; stories use that set to mirror the app. The
// component falls back to a common list when `options` is empty.
const GLAON_LOCALES = ['en', 'tr'] as const;

const meta: Meta<typeof LanguageSelect> = {
  title: 'App Primitives/LanguageSelect',
  component: LanguageSelect,
  parameters: {
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=app-primitives-language-select',
    },
  },
  args: { ...args, options: [...GLAON_LOCALES] },
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
type Story = StoryObj<typeof LanguageSelect>;

export const excludeFromArgs = languageSelectExcludeFromArgs;

/**
 * Default — Glaon's supported set (`en`, `tr`), auto-detect on. Each label
 * is the language's autonym (its name in its own language: `English`,
 * `Türkçe`). Plain dropdown (no in-field search), leading translate glyph.
 */
export const Default: Story = {};

/** Explicit `defaultValue` — starts on Turkish, auto-detect skipped. */
export const WithDefaultValue: Story = {
  args: { defaultValue: 'tr', autoDetect: false },
};

/** Auto-detect off — starts empty regardless of the browser language. */
export const AutoDetectOff: Story = {
  args: { autoDetect: false },
};

/**
 * Turkish locale — names render in Turkish (`Türkçe`, `İngilizce`) and
 * sort with Turkish collation.
 */
export const TurkishLocale: Story = {
  args: { locale: 'tr-TR', autoDetect: false, defaultValue: 'tr', label: 'Dil' },
};

/**
 * Wider option set — a scrollable dropdown of many languages (the fallback
 * list). No in-field search; options sort by their displayed (autonym) label.
 */
export const ManyLanguages: Story = {
  args: {
    options: ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar', 'ru', 'ja'],
    autoDetect: false,
  },
};

/** Disabled — trigger dimmed, popover does not open. */
export const Disabled: Story = {
  args: { defaultValue: 'en', autoDetect: false, isDisabled: true },
};

/** Invalid + hint — error styling; picking a language clears it. */
export const WithError: Story = {
  args: { autoDetect: false, isInvalid: true, hint: 'Language is required.' },
};

/** Size matrix — `sm`, `md`, `lg`. */
export const Sizes: Story = {
  parameters: { controls: { exclude: ['size', 'label'] } },
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <LanguageSelect
          key={size}
          {...args}
          size={size}
          label={`Size: ${size}`}
          autoDetect={false}
          defaultValue="en"
        />
      ))}
    </div>
  ),
};
