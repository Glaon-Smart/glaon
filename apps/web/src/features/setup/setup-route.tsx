// Glaon SetupRoute — top-level component for the first-run device setup
// wizard (epic #533, ADR 0028). Owns the step state machine and renders
// SetupLayout + the active step component.
//
// State design:
// - Active step id is a discriminated-union `WizardStepId` literal so the
//   compiler catches typos against the SETUP_STEPS table.
// - `collected` carries the partial DeviceConfig the user has filled in
//   so far, in route-local memory only — the ConfigStore is left
//   untouched until the Final Review step (#548) calls `markComplete()`.
//   Refreshing the wizard restarts at step 1; that is acceptable per the
//   epic body for a one-time flow and avoids partial localStorage writes
//   that would leave the device in a half-configured state.
// - `onNext(partial)` shallow-merges into `collected` and advances; on
//   the last step it is a no-op until #548 wires the commit. `onCancel`
//   is plumbed for future use but the v1 wizard hides the affordance
//   (the user cannot exit mid-flow).
//
// Each registered step component is a thin placeholder for #540 and
// #545–#548 to flesh out. Real form, Figma fidelity, i18n keys, and
// validation land per-step.

import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react';

import type { DeviceConfigInput } from '@glaon/core/config';
import { SetupLayout, type SetupLayoutStep } from '@glaon/ui';

import { ApplyStep } from './apply';
import { HomeOverviewStep } from './home-overview';
import { LayoutStep } from './layout';
import { NetworkStep } from './network';
import { SecurityStep } from './security';

// #597 collapsed the old wifi + review steps into a single terminal
// "apply" step. #629 adds a dedicated Network step (hostname + per-
// interface IPv4/IPv6 + Wi-Fi selection) between Security and Apply; the
// Wi-Fi picker moved out of Apply into Network, the destructive handoff
// stays terminal.
export type WizardStepId = 'home-overview' | 'layout' | 'security' | 'network' | 'apply';

// `WizardStepProps`, `SETUP_STEPS`, and `SetupRouteProps` stay unexported
// here: each subsequent step issue (#540, #545–#548) introduces its own
// file and re-exports the bits it needs. Limiting the public surface
// keeps knip's unused-export gate honest.
interface WizardStepProps {
  /** Partial DeviceConfig collected from earlier steps in this run. */
  readonly collected: DeviceConfigInput;
  /** Merge `partial` into `collected` and advance to the next step. */
  readonly onNext: (partial: DeviceConfigInput) => void;
  /**
   * Go back one step (#637). `undefined` on the first step so the step
   * hides its Back affordance. Navigating back keeps `collected` intact.
   */
  readonly onBack?: () => void;
  /** Step-level cancel affordance. v1 hides it; the prop is plumbed for future use. */
  readonly onCancel: () => void;
  /** True when this is the last step — the active step component owns the commit ceremony (#548). */
  readonly isLastStep: boolean;
}

interface WizardStepRegistration {
  readonly id: WizardStepId;
  readonly title: string;
  readonly description: string;
  readonly icon: ReactNode;
  readonly Component: ComponentType<WizardStepProps>;
}

// Inline SVG icons keyed off the step. Using inline SVG avoids the
// `@untitledui/icons` dependency leaking into apps/web (only @glaon/ui
// imports the kit's icon set) — same convention as ForgotPasswordPage.
const STEP_ICON_PATHS: Record<WizardStepId, string> = {
  'home-overview': 'M9 22V12h6v10M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z',
  layout: 'M3 4h18v16H3zM12 4v16',
  security: 'M12 4v16M4 12h16M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
  // Globe with meridians — the Network step configures hostname + per-
  // interface IPv4/IPv6 + Wi-Fi.
  network:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  // Wi-Fi bars — kept for the apply step because its destructive action
  // is the network switch.
  apply:
    'M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
};

function StepIcon({ id }: { id: WizardStepId }): ReactNode {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={STEP_ICON_PATHS[id]} />
    </svg>
  );
}

// Wizard ships 4 steps after #597 — the Wi-Fi credential collection
// + the Final Review summary merged into the terminal `apply` step
// (which owns the handoff ceremony).
const HomeOverviewStepAdapter = (props: WizardStepProps): ReactNode => (
  <HomeOverviewStep collected={props.collected} onNext={props.onNext} />
);
const LayoutStepAdapter = (props: WizardStepProps): ReactNode => (
  <LayoutStep
    collected={props.collected}
    onNext={props.onNext}
    {...(props.onBack !== undefined ? { onBack: props.onBack } : {})}
  />
);
const SecurityStepAdapter = (props: WizardStepProps): ReactNode => (
  <SecurityStep
    collected={props.collected}
    onNext={props.onNext}
    {...(props.onBack !== undefined ? { onBack: props.onBack } : {})}
  />
);
const NetworkStepAdapter = (props: WizardStepProps): ReactNode => (
  <NetworkStep
    collected={props.collected}
    onNext={props.onNext}
    {...(props.onBack !== undefined ? { onBack: props.onBack } : {})}
  />
);
const ApplyStepAdapter = (props: WizardStepProps): ReactNode => (
  <ApplyStep
    collected={props.collected}
    onNext={props.onNext}
    {...(props.onBack !== undefined ? { onBack: props.onBack } : {})}
  />
);

const SETUP_STEPS: readonly WizardStepRegistration[] = [
  {
    id: 'home-overview',
    title: 'Home Overview',
    description: 'Enter basic information about your home.',
    icon: <StepIcon id="home-overview" />,
    Component: HomeOverviewStepAdapter,
  },
  {
    id: 'layout',
    title: 'Layout Setup',
    description: 'Define floors and rooms to organize your space.',
    icon: <StepIcon id="layout" />,
    Component: LayoutStepAdapter,
  },
  {
    id: 'security',
    title: 'Device Security',
    description: 'Create a password to protect your smart devices.',
    icon: <StepIcon id="security" />,
    Component: SecurityStepAdapter,
  },
  {
    id: 'network',
    title: 'Network',
    description: 'Set the hostname and configure interfaces and Wi-Fi.',
    icon: <StepIcon id="network" />,
    Component: NetworkStepAdapter,
  },
  {
    id: 'apply',
    title: 'Save and apply',
    description: 'Review your settings, connect Wi-Fi, finish setup.',
    icon: <StepIcon id="apply" />,
    Component: ApplyStepAdapter,
  },
];

const FIRST_STEP_ID: WizardStepId = 'home-overview';

interface SetupRouteProps {
  /**
   * Override the starting step. Tests use this to mount directly into a
   * specific state; production callers omit it and let the wizard start
   * at the first registered step.
   */
  readonly initialStepId?: WizardStepId;
}

export function SetupRoute({ initialStepId }: SetupRouteProps = {}): ReactNode {
  // Per-step model (#646): each step reads its parameters from the device
  // and writes them back on Next, so there is no localStorage scratch to
  // persist — `collected` + `activeStepId` live in route-local memory
  // only. `collected` carries the accumulated input forward (the Apply
  // step's review + the terminal commit read it); the device, not the
  // browser, is the source of truth for anything already saved. A refresh
  // restarts at step 1 and re-seeds from the device, which is acceptable
  // for a one-time flow.
  const [collected, setCollected] = useState<DeviceConfigInput>({});
  const [activeStepId, setActiveStepId] = useState<WizardStepId>(initialStepId ?? FIRST_STEP_ID);

  const activeIndex = SETUP_STEPS.findIndex((step) => step.id === activeStepId);
  // findIndex returns -1 on miss; coerce that to 0 so an unknown step id
  // (impossible with the discriminated union but TS can't prove it) falls
  // back to the first step rather than crashing.
  const activeStep = SETUP_STEPS[activeIndex] ?? SETUP_STEPS[0];
  const isLastStep = activeIndex === SETUP_STEPS.length - 1;

  const onNext = useCallback(
    (partial: DeviceConfigInput) => {
      setCollected((prev) => ({ ...prev, ...partial }));
      const nextStep = SETUP_STEPS[activeIndex + 1];
      if (nextStep !== undefined) {
        setActiveStepId(nextStep.id);
      }
      // Last step: #548 wires the commit (configStore.setPartial +
      // markComplete + navigate to /login). For now Next is disabled on
      // the placeholder review step so this branch is unreachable.
    },
    [activeIndex, setActiveStepId, setCollected],
  );

  const onCancel = useCallback(() => {
    // v1 wizard cannot be exited; the placeholder steps do not render a
    // Cancel button. Future settings wizards can swap this for a real
    // affordance.
  }, []);

  // Back-navigation (#637). `onBack` steps one back; `onSelectStep` jumps
  // to any already-reached step from the rail. Forward jumps are blocked
  // (the Next button is the only way forward, so each step re-validates).
  // `collected` persists across both, so entered data survives.
  const onBack = useCallback(() => {
    const prevStep = SETUP_STEPS[activeIndex - 1];
    if (prevStep !== undefined) {
      setActiveStepId(prevStep.id);
    }
  }, [activeIndex, setActiveStepId]);

  const onSelectStep = useCallback(
    (id: string) => {
      const targetIndex = SETUP_STEPS.findIndex((step) => step.id === id);
      // Only allow jumping to the current step or earlier — never skipping
      // ahead past unvisited steps.
      const target = SETUP_STEPS[targetIndex];
      if (target !== undefined && targetIndex <= activeIndex) {
        setActiveStepId(target.id);
      }
    },
    [activeIndex, setActiveStepId],
  );

  // Steps the user can jump to from the rail: the active step and every
  // step before it. Future steps stay non-interactive.
  const navigableStepIds = useMemo<readonly string[]>(
    () => SETUP_STEPS.slice(0, activeIndex + 1).map((step) => step.id),
    [activeIndex],
  );

  const navSteps = useMemo<readonly SetupLayoutStep[]>(
    () =>
      SETUP_STEPS.map((step) => ({
        id: step.id,
        title: step.title,
        description: step.description,
        icon: step.icon,
      })),
    [],
  );

  // Derive the set of completed steps from the active step's position in
  // SETUP_STEPS: every step strictly before it is "done". The v1 wizard
  // locks the order so this matches the user's actual progress; if a
  // future wizard adds skipping, it can pass an explicit `completedStepIds`
  // to SetupLayout instead.
  const completedStepIds = useMemo<readonly string[]>(
    () => SETUP_STEPS.slice(0, Math.max(activeIndex, 0)).map((step) => step.id),
    [activeIndex],
  );

  if (activeStep === undefined) {
    // SETUP_STEPS is non-empty at module load — this branch exists only
    // to convince TS that ActiveStepComponent below is callable.
    return null;
  }

  const ActiveStepComponent = activeStep.Component;

  return (
    <SetupLayout
      steps={navSteps}
      activeStepId={activeStepId}
      completedStepIds={completedStepIds}
      onSelectStep={onSelectStep}
      navigableStepIds={navigableStepIds}
    >
      <ActiveStepComponent
        collected={collected}
        onNext={onNext}
        {...(activeIndex > 0 ? { onBack } : {})}
        onCancel={onCancel}
        isLastStep={isLastStep}
      />
    </SetupLayout>
  );
}

// The in-wizard sidebar language switcher (#570) was removed in #650: the
// Home Overview step's LanguageSelect is now the single language control
// (it live-switches the UI via i18n.changeLanguage and persists to HA +
// glaon.locale), so a second chrome-level control was redundant.
