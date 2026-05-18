import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InMemoryConfigStore } from '@glaon/core/config';

import { ConfigProvider } from '../../config/config-provider';
import { SetupRoute, type WizardStepId } from './setup-route';

function renderRoute(initialStepId?: WizardStepId) {
  return render(
    <ConfigProvider configStore={new InMemoryConfigStore()}>
      {initialStepId === undefined ? <SetupRoute /> : <SetupRoute initialStepId={initialStepId} />}
    </ConfigProvider>,
  );
}

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
    expect(container.querySelector('h1')?.textContent).toBe('Wi-Fi Configuration');
  });

  it('walks through every placeholder step up to Final Review', () => {
    const { container, getByRole } = renderRoute('layout');
    fireEvent.click(getByRole('button', { name: 'Next' })); // Wi-Fi
    fireEvent.click(getByRole('button', { name: 'Next' })); // Device Security
    fireEvent.click(getByRole('button', { name: 'Next' })); // Final Review
    expect(container.querySelector('h1')?.textContent).toBe('Final Review');
  });

  it('respects initialStepId and lands on Wi-Fi when asked', () => {
    const { container } = renderRoute('wifi');
    expect(container.querySelector('h1')?.textContent).toBe('Wi-Fi Configuration');
  });

  it('disables Next on the last step (commit ceremony lands in #548)', () => {
    const { getByRole } = renderRoute('review');
    const cta = getByRole('button', { name: 'Complete setup (TBD)' });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the active step with aria-current=step in the rail', () => {
    const { container } = renderRoute('wifi');
    const activeRail = container.querySelector('nav [aria-current="step"]');
    expect(activeRail?.textContent).toContain('Wi-Fi Configuration');
  });
});
