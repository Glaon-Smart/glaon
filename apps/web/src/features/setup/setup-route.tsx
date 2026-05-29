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

import { useCallback, useMemo, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput } from '@glaon/core/config';
import { SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '@glaon/core/i18n';
import { Select, SelectItem, type SelectItemType } from '@glaon/ui';
import { SetupLayout, type SetupLayoutStep } from '@glaon/ui';

import { useWizardState } from '../../setup/use-wizard-state';
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
  <LayoutStep collected={props.collected} onNext={props.onNext} />
);
const SecurityStepAdapter = (props: WizardStepProps): ReactNode => (
  <SecurityStep collected={props.collected} onNext={props.onNext} />
);
const NetworkStepAdapter = (props: WizardStepProps): ReactNode => (
  <NetworkStep collected={props.collected} onNext={props.onNext} />
);
const ApplyStepAdapter = (props: WizardStepProps): ReactNode => (
  <ApplyStep collected={props.collected} onNext={props.onNext} />
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
  // Persistence (#595): collected + activeStepId round-trip through
  // `localStorage` under `glaon.wizard.scratch` so a browser refresh
  // (or the Wi-Fi handoff's AP disconnect, #594/#596/#599) resumes
  // the wizard where the user left off. The `bypassStorage` flag
  // when an explicit `initialStepId` is passed keeps tests
  // deterministic — they never accidentally pick up a stray
  // scratch entry from a previous test in the same vitest worker.
  const { collected, activeStepId, setCollected, setActiveStepId } = useWizardState<WizardStepId>({
    initialStepId: initialStepId ?? FIRST_STEP_ID,
    bypassStorage: initialStepId !== undefined,
  });

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

  const onLocaleChange = useCallback(
    (next: SupportedLocale) => {
      setCollected((prev) => ({ ...prev, locale: next }));
    },
    [setCollected],
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
      controlsSlot={<WizardLocaleSwitcher onLocaleChange={onLocaleChange} />}
    >
      <ActiveStepComponent
        collected={collected}
        onNext={onNext}
        onCancel={onCancel}
        isLastStep={isLastStep}
      />
    </SetupLayout>
  );
}

interface WizardLocaleSwitcherProps {
  /**
   * Mirror the chosen locale into the wizard's `collected` state so the
   * final commit (#548) persists the user's actual choice. Without this,
   * the user could switch the chrome to Turkish but the post-wizard
   * `glaon.locale` would stay at whatever Home Overview's Language form
   * field defaulted to.
   */
  readonly onLocaleChange: (next: SupportedLocale) => void;
}

// In-wizard language switcher (#570). The wizard's chrome embeds this
// in the sidebar so a user who opened the wizard in the wrong locale
// can swap to their language without losing the data they've already
// filled in: route-local `collected` state survives because the wizard
// route does not unmount when i18next changes the active language.
// Persistence flows through i18next-browser-languagedetector → the same
// `glaon.locale` localStorage key the Home Overview step ultimately
// commits, so the post-wizard reload picks the choice up.
function WizardLocaleSwitcher({ onLocaleChange }: WizardLocaleSwitcherProps): ReactNode {
  const { t, i18n } = useTranslation();
  const active: SupportedLocale = isSupportedLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : 'en';
  const items: SelectItemType[] = SUPPORTED_LOCALES.map((code) => ({
    id: code,
    label: t(`languageSwitcher.options.${code}`),
  }));
  return (
    <Select
      aria-label={t('languageSwitcher.ariaLabel')}
      items={items}
      value={active}
      onChange={(key) => {
        if (typeof key === 'string' && isSupportedLocale(key)) {
          void i18n.changeLanguage(key);
          onLocaleChange(key);
        }
      }}
    >
      {(item) => <SelectItem key={item.id} id={item.id} label={item.label ?? ''} />}
    </Select>
  );
}
