import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryConfigStore } from '@glaon/core/config';
import { ToastProvider } from '@glaon/ui';

import { ConfigProvider } from '../../config/config-provider';
import { SetupRoute, type WizardStepId } from './setup-route';

function renderRoute(initialStepId?: WizardStepId) {
  return render(
    <ConfigProvider configStore={new InMemoryConfigStore()}>
      <ToastProvider>
        {initialStepId === undefined ? (
          <SetupRoute />
        ) : (
          <SetupRoute initialStepId={initialStepId} />
        )}
      </ToastProvider>
    </ConfigProvider>,
  );
}

// ApplyStep (#597, formerly the wifi + review pair) calls
// /api/hassio/network/info on mount unless the build is `standalone`.
// Stub fetch + VITE_APP_MODE so the walk-through tests don't hit a
// real network; the actual scan / commit behaviour lives in
// `apply/apply-step.test.tsx`.
beforeEach(() => {
  vi.stubEnv('VITE_APP_MODE', 'standalone');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('network'))),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('SetupRoute', () => {
  it('starts at the Home Overview step by default', () => {
    const { container } = renderRoute();
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Home Overview');
  });

  it('advances to the next step when Next is clicked', async () => {
    // Start at the Layout step so we exercise the Next path; Home
    // Overview's own form validation is covered in
    // `home-overview-step.test.tsx`. The Layout step now seeds from the
    // device first (#638) — the stubbed fetch rejects, so it settles to
    // the blank editor; await its Next button before clicking.
    const { container, findByRole } = renderRoute('layout');
    fireEvent.click(await findByRole('button', { name: 'Next' }));
    expect(container.querySelector('h1')?.textContent).toBe('Device Security');
  });

  it('renders the Network step (after Security in the 5-step order)', () => {
    // #629 inserts Network between Security and Apply. The fetch stub
    // rejects so the step lands in its error state, but the h1 (rendered
    // regardless of load state) is the routing signal we assert here.
    const { container } = renderRoute('network');
    expect(container.querySelector('h1')?.textContent).toBe('Network');
  });

  it('lands on the Apply step (terminal, after Network in the 5-step order)', () => {
    const { container } = renderRoute('apply');
    expect(container.querySelector('h1')?.textContent).toBe('Save and apply');
  });

  it('renders the Apply step with the Save and switch network CTA', () => {
    const { getByRole } = renderRoute('apply');
    // #597 — the merged step's terminal CTA replaces the old
    // "Complete setup" copy.
    expect(getByRole('button', { name: 'Save and switch network' })).toBeInTheDocument();
  });

  it('marks the active step with aria-current=step in the rail', () => {
    const { container } = renderRoute('apply');
    const activeRail = container.querySelector('nav [aria-current="step"]');
    // The rail label is the hardcoded SETUP_STEPS title ("Save and
    // apply"); the body title is the same i18n string in this case.
    expect(activeRail?.textContent).toContain('Save and apply');
  });

  // --- back-navigation (#637) ---

  it('jumps back to a prior step when its rail row is clicked', () => {
    const { container, getByRole } = renderRoute('network');
    expect(container.querySelector('h1')?.textContent).toBe('Network');
    // Layout (index 1) is before Network (index 3) → navigable rail button.
    fireEvent.click(getByRole('button', { name: /Layout Setup/i }));
    expect(container.querySelector('h1')?.textContent).toBe('Layout Setup');
  });

  it('goes back one step via the Back button', () => {
    const { container, getByTestId } = renderRoute('network');
    fireEvent.click(getByTestId('wizard-back'));
    expect(container.querySelector('h1')?.textContent).toBe('Device Security');
  });

  it('hides the Back button on the first step', () => {
    const { container, queryByTestId } = renderRoute();
    expect(container.querySelector('h1')?.textContent).toBe('Home Overview');
    expect(queryByTestId('wizard-back')).toBeNull();
  });

  it('does not make future steps clickable in the rail', () => {
    // At Security (index 2), Network + Apply are future → rendered as
    // non-interactive rows, not jump buttons.
    const { queryByRole } = renderRoute('security');
    expect(queryByRole('button', { name: /Save and apply/i })).toBeNull();
  });
});
