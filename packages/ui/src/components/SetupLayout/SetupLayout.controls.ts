// `SetupLayout.controls.ts` — single source of truth for SetupLayout's
// controllable props. Slot props (`logoSlot`, `controlsSlot`,
// `footerSlot`, `children`) and the `steps` array (ReactNode-bearing
// objects) live in `excludeFromArgs` because they don't render
// meaningfully via the controls panel.

import type { ControlSpec } from '../_internal/controls';
import { excludeFromArgs as defineExcludeFromArgs } from '../_internal/controls';

export const setupLayoutControls = {
  activeStepId: {
    type: 'text',
    default: 'home-overview',
    description:
      'Id of the active step in `steps`. The matching row uses the brand-coloured active state (filled icon container + brand title); previously-completed rows show a Check glyph; upcoming rows stay muted.',
    category: 'Content',
  } satisfies ControlSpec<string>,
} as const;

export const setupLayoutExcludeFromArgs = defineExcludeFromArgs([
  'steps',
  'completedStepIds',
  'onSelectStep',
  'navigableStepIds',
  'logoSlot',
  'controlsSlot',
  'footerSlot',
  'children',
] as const);
