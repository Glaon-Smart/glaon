import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Asterisk02, Columns02, HomeLine, Modem02, ThumbsUp } from '@untitledui/icons';
import { expect, fn, within } from 'storybook/test';

import { defineControls } from '../_internal/controls';
import { SetupStepNav, type SetupStepNavStep } from './SetupStepNav';
import { setupStepNavControls, setupStepNavExcludeFromArgs } from './SetupStepNav.controls';

const { args, argTypes } = defineControls(setupStepNavControls);

const meta: Meta<typeof SetupStepNav> = {
  title: 'App Primitives/SetupStepNav',
  component: SetupStepNav,
  // The prop-coverage gate's named export is data, not a story — see
  // the matching note on SetupLayout.stories.tsx for the rationale.
  excludeStories: ['excludeFromArgs'],
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'glaon-light-grey',
      values: [{ name: 'glaon-light-grey', value: '#e9eef4' }],
    },
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=1277-791',
    },
  },
  args,
  argTypes,
  decorators: [
    (Story) => (
      <div className="bg-[var(--glaon-light-grey)] p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SetupStepNav>;

export const excludeFromArgs = setupStepNavExcludeFromArgs;

const wizardSteps: SetupStepNavStep[] = [
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

export const Default: Story = {
  args: { activeStepId: 'home-overview' },
  render: (args) => <SetupStepNav {...args} steps={wizardSteps} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const active = canvas.getByText('Home Overview').closest('[aria-current="step"]');
    await expect(active).not.toBeNull();
  },
};

export const MidWizardActive: Story = {
  args: { activeStepId: 'wifi' },
  render: (args) => <SetupStepNav {...args} steps={wizardSteps} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Active row has aria-current=step; only one in the doc.
    const activeRows = canvasElement.querySelectorAll('[aria-current="step"]');
    await expect(activeRows.length).toBe(1);
    await expect(
      canvas.getByText('Wi-Fi Configuration').closest('[aria-current="step"]'),
    ).not.toBeNull();
  },
};

// Captures the three-state matrix in a single Chromatic baseline: the
// active row uses the brand-coloured fill (#570), the rows before it
// render as completed (Check glyph + tertiary text), and the rows
// after stay upcoming. This is the visual that ships in the v1 first-
// run wizard so we want it in the regression set explicitly.
export const MidWizardWithCompleted: Story = {
  args: { activeStepId: 'security' },
  render: (args) => (
    <SetupStepNav
      {...args}
      steps={wizardSteps}
      completedStepIds={['home-overview', 'layout', 'wifi']}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const activeRows = canvasElement.querySelectorAll('[aria-current="step"]');
    await expect(activeRows.length).toBe(1);
    await expect(
      canvas.getByText('Device Security').closest('[aria-current="step"]'),
    ).not.toBeNull();
  },
};

export const AllCompleted: Story = {
  args: { activeStepId: 'review' },
  render: (args) => (
    // Explicitly mark every step (including the active one) as completed
    // so every row renders the Check glyph. Useful for the post-wizard
    // success preview and for visual-regression coverage of the
    // completed icon swap.
    <SetupStepNav
      {...args}
      steps={wizardSteps}
      completedStepIds={wizardSteps.map((step) => step.id)}
    />
  ),
};

export const WithOnSelect: Story = {
  args: { activeStepId: 'wifi' },
  render: (args) => <SetupStepNav {...args} steps={wizardSteps} onSelect={fn()} />,
  play: async ({ canvasElement }) => {
    const buttons = canvasElement.querySelectorAll('button');
    await expect(buttons.length).toBe(wizardSteps.length);
  },
};

const singleStepFixture: SetupStepNavStep[] = [
  {
    id: 'home-overview',
    icon: <HomeLine />,
    title: 'Home Overview',
    description: 'Enter basic information about your home.',
  },
];

export const SingleStep: Story = {
  args: { activeStepId: 'home-overview' },
  render: (args) => <SetupStepNav {...args} steps={singleStepFixture} />,
};
