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

// WifiStep (#546) calls /api/hassio/network/info on mount unless the
// build is `standalone`. Stub fetch + VITE_APP_MODE so the placeholder
// walk-through tests don't hit a real network — actual Wi-Fi behaviour
// is covered in `wifi/wifi-step.test.tsx`.
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
    // path; Home Overview (#540) requires its own form to validate
    // before advancing — covered in `home-overview-step.test.tsx`.
    const { container, getByRole } = renderRoute('layout');
    const next = getByRole('button', { name: 'Next' });
    fireEvent.click(next);
    expect(container.querySelector('h1')?.textContent).toBe('Wi-Fi Connection');
  });

  it('walks from Layout placeholder through Wi-Fi standalone to Device Security', () => {
    // Wi-Fi is in standalone mode (per the beforeEach stub) so Next
    // advances without selection; Device Security requires real password
    // input — covered in security-step.test.tsx. Walking past it to
    // Review is a separate path tested via initialStepId='review'.
    const { container, getByRole } = renderRoute('layout');
    fireEvent.click(getByRole('button', { name: 'Next' })); // Layout → Wi-Fi
    fireEvent.click(getByRole('button', { name: 'Next' })); // Wi-Fi standalone → Security
    expect(container.querySelector('h1')?.textContent).toBe('Device Security');
  });

  it('respects initialStepId and lands on Wi-Fi when asked', () => {
    const { container } = renderRoute('wifi');
    expect(container.querySelector('h1')?.textContent).toBe('Wi-Fi Connection');
  });

  it('renders the Final Review step with the Complete setup CTA', () => {
    const { getByRole } = renderRoute('review');
    // #548 wires the real commit ceremony; the CTA is enabled by
    // default (the dialog gates the actual submit for secured Wi-Fi).
    expect(getByRole('button', { name: 'Complete setup' })).toBeInTheDocument();
  });

  it('marks the active step with aria-current=step in the rail', () => {
    const { container } = renderRoute('wifi');
    const activeRail = container.querySelector('nav [aria-current="step"]');
    // The rail label is the hardcoded SETUP_STEPS title ("Wi-Fi
    // Configuration"); the body title is the i18n one ("Wi-Fi
    // Connection") rendered by WifiStep. The test asserts on the rail.
    expect(activeRail?.textContent).toContain('Wi-Fi Configuration');
  });
});
