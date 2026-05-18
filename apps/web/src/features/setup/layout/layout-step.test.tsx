import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LayoutStep } from './layout-step';

describe('LayoutStep', () => {
  it('renders the title and the optional layout field', () => {
    const { container, getByText } = render(<LayoutStep collected={{}} onNext={() => undefined} />);
    expect(container.querySelector('h1')?.textContent).toBe('Layout Setup');
    expect(getByText(/Home structure/)).toBeInTheDocument();
  });

  it('submits an empty partial when the field is left blank (no required validation)', () => {
    const onNext = vi.fn();
    const { getByRole } = render(<LayoutStep collected={{}} onNext={onNext} />);
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext.mock.calls[0]?.[0]).toEqual({});
  });

  it('passes the trimmed layout string through onNext when filled', () => {
    const onNext = vi.fn();
    const { container, getByRole } = render(<LayoutStep collected={{}} onNext={onNext} />);
    const input = container.querySelector('input[type="text"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    fireEvent.change(input, { target: { value: '  2 floors, 5 rooms  ' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    const partial = onNext.mock.calls[0]?.[0] as { layout?: string };
    expect(partial.layout).toBe('2 floors, 5 rooms');
  });

  it('hydrates layout from collected partial', () => {
    const { container } = render(
      <LayoutStep collected={{ layout: 'open-plan' }} onNext={() => undefined} />,
    );
    const input = container.querySelector('input[type="text"]');
    expect((input as HTMLInputElement | null)?.value).toBe('open-plan');
  });
});
