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

import { HomeOverviewStep } from './home-overview';

export type WizardStepId = 'home-overview' | 'layout' | 'wifi' | 'security' | 'review';

// `WizardStepProps`, `SETUP_STEPS`, and `SetupRouteProps` stay unexported
// here: each subsequent step issue (#540, #545–#548) introduces its own
// file and re-exports the bits it needs. Limiting the public surface
// keeps knip's unused-export gate honest.
interface WizardStepProps {
  /** Partial DeviceConfig collected from earlier steps in this run. */
  readonly collected: DeviceConfigInput;
  /** Merge `partial` into `collected` and advance to the next step. */
  readonly onNext: (partial: DeviceConfigInput) => void;
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
  wifi: 'M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
  security: 'M12 4v16M4 12h16M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
  review: 'M7 11v9H3v-9h4zm0 0V8a3 3 0 0 1 3-3l4 9v7H9a2 2 0 0 1-2-2v-2',
};

function StepIcon({ id }: { id: WizardStepId }): ReactNode {
  return (
    <svg
      className="size-5 text-secondary"
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

// Placeholder step bodies. #540 and #545–#548 replace each entry with
// its real implementation (Figma-pixel-matched form + i18n + validation).
function PlaceholderStep({ title, onNext, isLastStep }: PlaceholderProps): ReactNode {
  return (
    <div className="flex flex-col gap-6 p-8 lg:p-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-display-xs font-semibold text-primary">{title}</h1>
        <p className="text-md text-tertiary">
          Step UI ships in its own issue; this placeholder unblocks the gate + routing wiring.
        </p>
      </header>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            onNext({});
          }}
          disabled={isLastStep}
          className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isLastStep ? 'Complete setup (TBD)' : 'Next'}
        </button>
      </div>
    </div>
  );
}

interface PlaceholderProps {
  readonly title: string;
  readonly onNext: (partial: DeviceConfigInput) => void;
  readonly isLastStep: boolean;
}

// Real step component for #540; the rest of the wizard's steps still
// render the inline placeholder until their issues land.
const HomeOverviewStepAdapter = (props: WizardStepProps): ReactNode => (
  <HomeOverviewStep collected={props.collected} onNext={props.onNext} />
);
const LayoutPlaceholder = (props: WizardStepProps): ReactNode => (
  <PlaceholderStep title="Layout Setup" onNext={props.onNext} isLastStep={props.isLastStep} />
);
const WifiPlaceholder = (props: WizardStepProps): ReactNode => (
  <PlaceholderStep
    title="Wi-Fi Configuration"
    onNext={props.onNext}
    isLastStep={props.isLastStep}
  />
);
const SecurityPlaceholder = (props: WizardStepProps): ReactNode => (
  <PlaceholderStep title="Device Security" onNext={props.onNext} isLastStep={props.isLastStep} />
);
const ReviewPlaceholder = (props: WizardStepProps): ReactNode => (
  <PlaceholderStep title="Final Review" onNext={props.onNext} isLastStep={props.isLastStep} />
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
    Component: LayoutPlaceholder,
  },
  {
    id: 'wifi',
    title: 'Wi-Fi Configuration',
    description: 'Connect to your network and set a secure password.',
    icon: <StepIcon id="wifi" />,
    Component: WifiPlaceholder,
  },
  {
    id: 'security',
    title: 'Device Security',
    description: 'Create a password to protect your smart devices.',
    icon: <StepIcon id="security" />,
    Component: SecurityPlaceholder,
  },
  {
    id: 'review',
    title: 'Final Review',
    description: 'Check your settings and complete the setup.',
    icon: <StepIcon id="review" />,
    Component: ReviewPlaceholder,
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
  const [activeStepId, setActiveStepId] = useState<WizardStepId>(initialStepId ?? FIRST_STEP_ID);
  const [collected, setCollected] = useState<DeviceConfigInput>({});

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
    [activeIndex],
  );

  const onCancel = useCallback(() => {
    // v1 wizard cannot be exited; the placeholder steps do not render a
    // Cancel button. Future settings wizards can swap this for a real
    // affordance.
  }, []);

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

  if (activeStep === undefined) {
    // SETUP_STEPS is non-empty at module load — this branch exists only
    // to convince TS that ActiveStepComponent below is callable.
    return null;
  }

  const ActiveStepComponent = activeStep.Component;

  return (
    <SetupLayout steps={navSteps} activeStepId={activeStepId}>
      <ActiveStepComponent
        collected={collected}
        onNext={onNext}
        onCancel={onCancel}
        isLastStep={isLastStep}
      />
    </SetupLayout>
  );
}
