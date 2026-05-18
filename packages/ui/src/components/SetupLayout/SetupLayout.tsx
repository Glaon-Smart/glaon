// Glaon SetupLayout — page chrome for the first-run setup wizard
// (epic #533, ADR 0028). Sibling primitive to AuthLayout, not a variant —
// the chrome is materially different (vertical step rail on the left, no
// brand image, fixed footer with brand + contact).
//
// Pixel-matches Figma node `1277:791` (Design System / SETUP progress 01 /
// Desktop) at 1440px. The right-column content (form title / fields /
// CTAs) is the step component's responsibility, supplied via `children`.
//
// SetupLayout is purely presentational — no async state, no ConfigStore
// reads, no router knowledge. SetupRoute (#539) owns the state machine
// and feeds the active step's component into `children`.
//
// The step rail is rendered by the dedicated `SetupStepNav` primitive
// (#538). SetupLayout supplies the surrounding chrome and passes through
// the `steps` / `activeStepId` / `completedStepIds` / `onSelectStep`
// props.

import type { ReactNode } from 'react';

import { Logo } from '../Logo';
import { SetupStepNav, type SetupStepNavStep } from '../SetupStepNav';

/**
 * Step shape consumed by SetupLayout. Re-exported as the SetupStepNav
 * primitive's `SetupStepNavStep` so callers that only depend on
 * SetupLayout do not need a second import.
 */
export type SetupLayoutStep = SetupStepNavStep;

export interface SetupLayoutProps {
  /** Ordered list of wizard steps rendered in the left rail. */
  steps: readonly SetupLayoutStep[];
  /** Id of the active step. Forwarded to SetupStepNav. */
  activeStepId: string;
  /**
   * Optional override for which steps are considered completed. Forwarded
   * to SetupStepNav. When omitted, SetupStepNav defaults to "every step
   * before `activeStepId` in `steps` order". The v1 first-run wizard
   * accepts the default; callers that allow skipping pass an explicit list.
   */
  completedStepIds?: readonly string[];
  /**
   * Optional click handler. Forwarded to SetupStepNav. When provided the
   * rail rows become click-to-jump buttons. The v1 first-run wizard does
   * not pass this (the order is locked).
   */
  onSelectStep?: (id: string) => void;
  /**
   * Override for the brand logo at the top-left of the sidebar. Defaults
   * to `<Logo size={133} />` (matches Figma's 133×60 wordmark). Pass
   * `null` to suppress.
   */
  logoSlot?: ReactNode;
  /**
   * Optional control surface rendered in the sidebar above the footer.
   * v1 wizard uses this to host the in-flow language switcher (#570) so
   * a user who opened the wizard in the wrong locale can fix it without
   * abandoning their progress. Default is no slot — non-wizard consumers
   * pass nothing and the sidebar collapses around the gap.
   */
  controlsSlot?: ReactNode;
  /**
   * Override for the sidebar footer. Defaults to `© Glaon {year}` on the
   * left and `help@glaon.com` on the right (with a Glaon mail icon). Pass
   * `null` to suppress.
   */
  footerSlot?: ReactNode;
  /**
   * Right-column content. Step components render their own header, form,
   * and CTAs here — SetupLayout does not impose padding so the step can
   * pick its own gutter (the Figma frame uses generous internal padding
   * that varies per step).
   */
  children?: ReactNode;
}

export function SetupLayout({
  steps,
  activeStepId,
  completedStepIds,
  onSelectStep,
  logoSlot,
  controlsSlot,
  footerSlot,
  children,
}: SetupLayoutProps) {
  // `logoSlot === undefined` → render the default. `logoSlot === null` →
  // suppress entirely. Same distinction as AuthLayout (the AuthLayout
  // pattern documents why this matters for Storybook controls panels).
  const logo = logoSlot === undefined ? <Logo size={133} /> : logoSlot;
  const footer =
    footerSlot === undefined ? <DefaultSetupFooter year={new Date().getFullYear()} /> : footerSlot;

  return (
    <div className="flex min-h-screen flex-col bg-primary lg:h-screen lg:min-h-0 lg:flex-row lg:overflow-hidden">
      <aside
        className="flex flex-col justify-between bg-[var(--glaon-light-grey)] lg:h-full lg:w-full lg:max-w-[384px] lg:shrink-0"
        aria-label="Setup wizard navigation"
      >
        <div className="flex flex-col gap-16 px-8 pt-8">
          {logo !== null && <div className="h-[60px] w-[133px]">{logo}</div>}
          <SetupStepNav
            steps={steps}
            activeStepId={activeStepId}
            {...(completedStepIds === undefined ? {} : { completedStepIds })}
            {...(onSelectStep === undefined ? {} : { onSelect: onSelectStep })}
          />
        </div>
        <div className="flex flex-col">
          {controlsSlot !== undefined && controlsSlot !== null && (
            <div className="px-8 pb-4">{controlsSlot}</div>
          )}
          {footer !== null && (
            <div className="flex h-24 items-end justify-between p-8 text-sm text-tertiary">
              {footer}
            </div>
          )}
        </div>
      </aside>
      <main className="flex flex-1 flex-col lg:min-w-[480px] lg:overflow-y-auto">{children}</main>
    </div>
  );
}

interface DefaultSetupFooterProps {
  readonly year: number;
}

function DefaultSetupFooter({ year }: DefaultSetupFooterProps) {
  return (
    <>
      <p>© Glaon {year.toString()}</p>
      <a
        href="mailto:help@glaon.com"
        className="inline-flex items-center gap-2 text-tertiary hover:text-secondary"
      >
        {/* Inline minimal mail icon — keeps the footer dependency-free; the
         * Figma uses UUI mail-01 outline at size 16. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="1.667" y="2.667" width="12.667" height="10.667" rx="1.5" />
          <path d="M2 3.333 8 8l6-4.667" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>help@glaon.com</span>
      </a>
    </>
  );
}
