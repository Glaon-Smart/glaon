import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Asterisk02, Columns02, HomeLine, Modem02, ThumbsUp } from '@untitledui/icons';

import { defineControls } from '../_internal/controls';
import { SetupLayout, type SetupLayoutStep } from './SetupLayout';
import { setupLayoutControls, setupLayoutExcludeFromArgs } from './SetupLayout.controls';

const { args, argTypes } = defineControls(setupLayoutControls);

const meta: Meta<typeof SetupLayout> = {
  title: 'App Primitives/SetupLayout',
  component: SetupLayout,
  // Storybook CSF treats every named export as a story. The
  // `excludeFromArgs` constant we export for the F6 prop-coverage gate
  // (`packages/ui/src/__tests__/prop-coverage.test.ts`) is not a story —
  // explicitly excluding it stops the test runner from rendering it
  // (without `steps`, the default render would crash because `steps` is
  // a required prop).
  excludeStories: ['excludeFromArgs'],
  parameters: {
    layout: 'fullscreen',
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=1277-791',
    },
  },
  args,
  argTypes,
};

export default meta;
type Story = StoryObj<typeof SetupLayout>;

export const excludeFromArgs = setupLayoutExcludeFromArgs;

const wizardSteps: SetupLayoutStep[] = [
  {
    id: 'home-overview',
    icon: <HomeLine />,
    title: 'Home Overview',
    description: 'Enter basic information about your home.',
  },
  {
    id: 'layout',
    icon: <Columns02 />,
    title: 'Layout Setup',
    description: 'Define floors and rooms to organize your space.',
  },
  {
    id: 'wifi',
    icon: <Modem02 />,
    title: 'Wi-Fi Configuration',
    description: 'Connect to your network and set a secure password.',
  },
  {
    id: 'security',
    icon: <Asterisk02 />,
    title: 'Device Security',
    description: 'Create a password to protect your smart devices.',
  },
  {
    id: 'review',
    icon: <ThumbsUp />,
    title: 'Final Review',
    description: 'Check your settings and complete the setup.',
  },
];

// Placeholder right-column content. Each step issue (#540, #545–#548)
// replaces this with the real form for its step.
const placeholderContent = (
  <div className="flex flex-col gap-6 p-8 lg:p-12">
    <header className="flex flex-col gap-3">
      <h1 className="text-display-xs font-semibold text-primary">Home Overview</h1>
      <p className="text-md text-tertiary">
        Manage your team members and their account permissions here.
      </p>
    </header>
    <div className="flex flex-col gap-4">
      <div className="rounded-lg bg-secondary px-3 py-3 text-sm text-tertiary">Home Name</div>
      <div className="rounded-lg bg-secondary px-3 py-3 text-sm text-tertiary">Location</div>
      <div className="rounded-lg bg-secondary px-3 py-3 text-sm text-tertiary">Country</div>
    </div>
    <div className="flex justify-end gap-3">
      <div className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-secondary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset">
        Cancel
      </div>
      <div className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white">
        Next
      </div>
    </div>
  </div>
);

export const HomeOverviewActive: Story = {
  args: { activeStepId: 'home-overview' },
  render: (args) => (
    <SetupLayout {...args} steps={wizardSteps}>
      {placeholderContent}
    </SetupLayout>
  ),
};

export const LayoutSetupActive: Story = {
  args: { activeStepId: 'layout' },
  render: (args) => (
    <SetupLayout {...args} steps={wizardSteps}>
      {placeholderContent}
    </SetupLayout>
  ),
};

export const WifiConfigurationActive: Story = {
  args: { activeStepId: 'wifi' },
  render: (args) => (
    <SetupLayout {...args} steps={wizardSteps}>
      {placeholderContent}
    </SetupLayout>
  ),
};

export const DeviceSecurityActive: Story = {
  args: { activeStepId: 'security' },
  render: (args) => (
    <SetupLayout {...args} steps={wizardSteps}>
      {placeholderContent}
    </SetupLayout>
  ),
};

export const FinalReviewActive: Story = {
  args: { activeStepId: 'review' },
  render: (args) => (
    <SetupLayout {...args} steps={wizardSteps}>
      {placeholderContent}
    </SetupLayout>
  ),
};

export const WithoutFooter: Story = {
  args: { activeStepId: 'home-overview' },
  render: (args) => (
    <SetupLayout {...args} steps={wizardSteps} footerSlot={null}>
      {placeholderContent}
    </SetupLayout>
  ),
};

export const WithoutLogo: Story = {
  args: { activeStepId: 'home-overview' },
  render: (args) => (
    <SetupLayout {...args} steps={wizardSteps} logoSlot={null}>
      {placeholderContent}
    </SetupLayout>
  ),
};

// Mirrors what the production wizard renders mid-flow (#570): the
// active step is brand-coloured, the steps before it carry the
// completed Check glyph, and the sidebar's `controlsSlot` hosts an
// in-flow language switcher (placeholder `<select>` in the story —
// the real wizard mounts a Glaon Select primitive).
export const MidWizardWithControls: Story = {
  args: { activeStepId: 'wifi' },
  render: (args) => (
    <SetupLayout
      {...args}
      steps={wizardSteps}
      completedStepIds={['home-overview', 'layout']}
      controlsSlot={
        <label className="flex flex-col gap-1 text-sm text-tertiary">
          <span>Language</span>
          <select
            aria-label="Choose interface language"
            defaultValue="en"
            className="rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset"
          >
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
        </label>
      }
    >
      {placeholderContent}
    </SetupLayout>
  ),
};
