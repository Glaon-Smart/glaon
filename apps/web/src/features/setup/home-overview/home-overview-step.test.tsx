import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HomeOverviewStep } from './home-overview-step';

describe('HomeOverviewStep', () => {
  it('renders the title and the home name field', () => {
    const { container, getByText } = render(
      <HomeOverviewStep collected={{}} onNext={() => undefined} />,
    );
    expect(container.querySelector('h1')?.textContent).toBe('Home Overview');
    // Home name label is the only required-marked row.
    expect(getByText(/Home Name/)).toBeInTheDocument();
  });

  it('blocks submission when home name is empty and shows an inline error', () => {
    const onNext = vi.fn();
    const { getByRole, queryByRole } = render(<HomeOverviewStep collected={{}} onNext={onNext} />);
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).not.toHaveBeenCalled();
    // The inline error renders via <p role="alert"> — Toast Rule says
    // local field validation stays inline, never Toast.
    expect(queryByRole('alert')).not.toBeNull();
  });

  it('submits trimmed home name + defaults when the form is filled', () => {
    const onNext = vi.fn();
    const { container, getByRole } = render(<HomeOverviewStep collected={{}} onNext={onNext} />);
    const homeNameInput = container.querySelector('input[type="text"]');
    expect(homeNameInput).not.toBeNull();
    if (homeNameInput === null) return;
    fireEvent.change(homeNameInput, { target: { value: '  Olivia  ' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    const partial = onNext.mock.calls[0]?.[0] as { homeName?: string; unitSystem?: string };
    expect(partial.homeName).toBe('Olivia');
    expect(partial.unitSystem).toBe('metric');
  });

  it('hydrates form state from already-collected partial', () => {
    const { container } = render(
      <HomeOverviewStep
        collected={{ homeName: 'Glaon HQ', unitSystem: 'imperial' }}
        onNext={() => undefined}
      />,
    );
    const homeNameInput = container.querySelector('input[type="text"]');
    expect((homeNameInput as HTMLInputElement | null)?.value).toBe('Glaon HQ');
  });
});
