// Glaon SetupStepNav — vertical step navigator for the first-run setup
// wizard (epic #533, ADR 0028). Extracted from SetupLayout's inline impl
// (#537) into its own primitive so the visual states are exercised
// independently in Storybook + Chromatic.
//
// Three visual states:
//   - active     — title in `text-brand-secondary`, icon container
//                  uses `bg-brand-solid` with a white icon glyph so the
//                  current step is obvious at a glance against the
//                  light-grey sidebar. The single row that matches
//                  `activeStepId`.
//   - completed  — title in `text-tertiary` (#525252), icon replaced by
//                  a Check glyph so the user can scan past finished steps.
//   - upcoming   — title in `text-tertiary` (#525252), icon as supplied.
//
// Color tokens are chosen so every state passes WCAG AA on the
// `--glaon-light-grey` sidebar background that SetupLayout draws — see
// the SetupLayout fidelity note for the contrast rationale.
//
// When `onSelect` is provided each row renders as a `<button>`, so the
// nav doubles as a click-to-jump control (settings wizards, post-launch
// flows). The v1 first-run wizard omits `onSelect` and the nav renders
// as a non-interactive `<ol>`.

import { Check } from '@untitledui/icons';
import type { ReactNode } from 'react';

export interface SetupStepNavStep {
  /** Stable identifier — matched against `activeStepId` / `completedStepIds`. */
  id: string;
  /**
   * Icon node for the 40×40 featured-icon container. Replaced by a
   * Check glyph when the step is marked completed.
   */
  icon: ReactNode;
  /** Bold title — Inter Semi Bold, text-sm. */
  title: string;
  /** Optional descriptive line under the title. */
  description?: string;
}

export interface SetupStepNavProps {
  /** Ordered list of wizard steps. */
  steps: readonly SetupStepNavStep[];
  /** The id of the currently-active step. */
  activeStepId: string;
  /**
   * Step ids to render as completed (Check glyph + muted title). When
   * omitted, every step before `activeStepId` in `steps` order is
   * considered completed. Pass `[]` to disable the default (e.g. if
   * the wizard allows arbitrary skipping).
   */
  completedStepIds?: readonly string[];
  /**
   * Optional click handler. When provided a row becomes a `<button>` so
   * the nav is interactive (click-to-jump). When undefined, rows render
   * as non-interactive `<li>` content.
   */
  onSelect?: (id: string) => void;
  /**
   * Restricts which rows are clickable when `onSelect` is provided. A row
   * is interactive only if its id is in this list (e.g. the wizard passes
   * the steps the user has already reached, so they can jump back but not
   * skip ahead). When omitted, every row is clickable — the default for
   * an unconstrained click-to-jump nav.
   */
  navigableStepIds?: readonly string[];
  /** Optional class hook for the outer `<nav>`. */
  className?: string;
}

type StepState = 'active' | 'completed' | 'upcoming';

function resolveStepState(
  stepId: string,
  activeStepId: string,
  completed: ReadonlySet<string>,
): StepState {
  if (stepId === activeStepId) return 'active';
  if (completed.has(stepId)) return 'completed';
  return 'upcoming';
}

function defaultCompletedIds(
  steps: readonly SetupStepNavStep[],
  activeStepId: string,
): readonly string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.id === activeStepId) break;
    ids.push(step.id);
  }
  return ids;
}

export function SetupStepNav({
  steps,
  activeStepId,
  completedStepIds,
  onSelect,
  navigableStepIds,
  className,
}: SetupStepNavProps) {
  const completedSet = new Set(completedStepIds ?? defaultCompletedIds(steps, activeStepId));
  const navigableSet = navigableStepIds === undefined ? undefined : new Set(navigableStepIds);
  return (
    <nav aria-label="Wizard progress" className={className ?? 'w-[320px]'}>
      <ol className="flex flex-col">
        {steps.map((step, index) => {
          const state = resolveStepState(step.id, activeStepId, completedSet);
          const isLast = index === steps.length - 1;
          // A row is interactive only when a handler is supplied AND the
          // step is navigable (no restriction list → all navigable).
          const interactive =
            onSelect !== undefined && (navigableSet === undefined || navigableSet.has(step.id));
          return (
            <SetupStepNavItem
              key={step.id}
              step={step}
              state={state}
              isLast={isLast}
              {...(interactive ? { onSelect } : {})}
            />
          );
        })}
      </ol>
    </nav>
  );
}

interface SetupStepNavItemProps {
  readonly step: SetupStepNavStep;
  readonly state: StepState;
  readonly isLast: boolean;
  readonly onSelect?: (id: string) => void;
}

function SetupStepNavItem({ step, state, isLast, onSelect }: SetupStepNavItemProps) {
  const isActive = state === 'active';
  const isCompleted = state === 'completed';
  // Active step gets brand-coloured emphasis (#570) so the user can spot
  // their position at a glance — the prior `text-secondary` treatment
  // was too close to the inactive `text-tertiary` on the light-grey
  // sidebar. Completed + upcoming both stay `text-tertiary`; the
  // completed Check glyph differentiates the two.
  const titleClass = `text-sm font-semibold leading-5 ${isActive ? 'text-brand-secondary' : 'text-tertiary'}`;
  const descriptionClass = 'text-sm font-normal leading-5 text-tertiary';
  const iconNode = isCompleted ? <Check aria-hidden="true" /> : step.icon;
  const base =
    'z-[1] flex size-10 shrink-0 items-center justify-center rounded-lg shadow-xs-skeuomorphic ring-1 ring-inset';
  let iconContainerClass: string;
  if (isActive) {
    iconContainerClass = `${base} bg-brand-solid text-white ring-brand`;
  } else if (isCompleted) {
    iconContainerClass = `${base} bg-success-solid text-white ring-[var(--color-bg-success-solid)]`;
  } else {
    iconContainerClass = `${base} bg-primary text-secondary ring-primary`;
  }
  const textBlock = (
    <div
      className="flex flex-1 flex-col pb-8 text-left"
      aria-current={isActive ? 'step' : undefined}
    >
      <p className={titleClass}>{step.title}</p>
      {step.description !== undefined && step.description !== '' && (
        <p className={descriptionClass}>{step.description}</p>
      )}
    </div>
  );

  return (
    <li className="flex items-start gap-3">
      <div className="flex flex-col items-center gap-1 self-stretch pb-1">
        <div className={iconContainerClass}>
          <span aria-hidden="true" className="block size-5">
            {iconNode}
          </span>
        </div>
        {!isLast && <div className="w-px flex-1 bg-[var(--color-neutral-300)]" />}
      </div>
      {onSelect === undefined ? (
        textBlock
      ) : (
        <button
          type="button"
          onClick={() => {
            onSelect(step.id);
          }}
          className="flex flex-1 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          {textBlock}
        </button>
      )}
    </li>
  );
}
