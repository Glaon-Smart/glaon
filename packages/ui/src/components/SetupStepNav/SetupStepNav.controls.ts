// `SetupStepNav.controls.ts` — Storybook control spec for SetupStepNav.
// `steps`, `completedStepIds`, `onSelect`, `navigableStepIds`, `className`
// live in `excludeFromArgs` because they carry ReactNode / callable /
// array values that don't render through the controls panel.

import type { ControlSpec } from '../_internal/controls';
import { excludeFromArgs as defineExcludeFromArgs } from '../_internal/controls';

export const setupStepNavControls = {
  activeStepId: {
    type: 'text',
    default: 'home-overview',
    description:
      'Id of the active step in `steps`. The matching row uses the active visual state; rows before it in `steps` order get the completed state by default; rows after it get the upcoming state.',
    category: 'Content',
  } satisfies ControlSpec<string>,
} as const;

export const setupStepNavExcludeFromArgs = defineExcludeFromArgs([
  'steps',
  'completedStepIds',
  'onSelect',
  'navigableStepIds',
  'className',
] as const);
