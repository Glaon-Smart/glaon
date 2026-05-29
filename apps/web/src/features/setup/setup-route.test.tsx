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

  it('advances to the next step when the placeholder Next button is clicked', () => {
    // Start at the Layout step so we exercise the placeholder Next
    // path; Home Overview's own form validation is covered in
    // `home-overview-step.test.tsx`.
    const { container, getByRole } = renderRoute('layout');
    const next = getByRole('button', { name: 'Next' });
    fireEvent.click(next);
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
});
