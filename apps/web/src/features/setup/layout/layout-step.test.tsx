// Smoke-level UI coverage. The reducer's correctness is tested
// exhaustively in `use-layout-state.test.ts`; here we just verify
// the default state renders, the add-floor / add-room affordances
// dispatch into the reducer, and the form submit emits the new
// structured `layout` blob (not a free-text string).

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Layout } from '@glaon/core/config';

import { LayoutStep } from './layout-step';

describe('LayoutStep', () => {
  it('renders the title and the default single floor', () => {
    const { container, getByText } = render(<LayoutStep collected={{}} onNext={() => undefined} />);
    expect(container.querySelector('h1')?.textContent).toBe('Layout Setup');
    // The default floor name comes from the EN locale string.
    expect(getByText('Ground Floor')).toBeInTheDocument();
  });

  it('submits the default single-floor layout on Next', () => {
    const onNext = vi.fn();
    const { getByRole } = render(<LayoutStep collected={{}} onNext={onNext} />);
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    const partial = onNext.mock.calls[0]?.[0] as { layout?: Layout };
    expect(partial.layout?.floors).toHaveLength(1);
    expect(partial.layout?.floors[0]?.name).toBe('Ground Floor');
    expect(partial.layout?.floors[0]?.rooms).toEqual([]);
  });

  it('adds a second floor via the "Add floor" pill', () => {
    const onNext = vi.fn();
    const { getByRole } = render(<LayoutStep collected={{}} onNext={onNext} />);
    fireEvent.click(getByRole('button', { name: /Add floor/i }));
    fireEvent.click(getByRole('button', { name: 'Next' }));
    const partial = onNext.mock.calls[0]?.[0] as { layout?: Layout };
    expect(partial.layout?.floors).toHaveLength(2);
    // Second floor seeded with an empty rooms list. Name comes
    // from the locale template; we don't assert the exact label
    // because ICU interpolation isn't deterministic across the
    // vitest setup permutations.
    expect(partial.layout?.floors[1]?.rooms).toEqual([]);
  });

  it('adds a room via the empty-state CTA on the default floor', () => {
    const onNext = vi.fn();
    const { getByRole } = render(<LayoutStep collected={{}} onNext={onNext} />);
    fireEvent.click(getByRole('button', { name: /Add your first room/i }));
    fireEvent.click(getByRole('button', { name: 'Next' }));
    const partial = onNext.mock.calls[0]?.[0] as { layout?: Layout };
    expect(partial.layout?.floors[0]?.rooms).toHaveLength(1);
    expect(typeof partial.layout?.floors[0]?.rooms[0]?.name).toBe('string');
    expect((partial.layout?.floors[0]?.rooms[0]?.name ?? '').length).toBeGreaterThan(0);
  });

  it('hydrates from a previously collected layout', () => {
    const layout: Layout = {
      floors: [
        {
          id: 'f-loaded',
          name: 'Penthouse',
          rooms: [{ id: 'r-loaded', name: 'Solarium', type: 'living' }],
        },
      ],
    };
    const { container, getByDisplayValue } = render(
      <LayoutStep collected={{ layout }} onNext={() => undefined} />,
    );
    // The floor name renders as the active-tab pill button text.
    expect(container.textContent ?? '').toMatch(/Penthouse/);
    // The room name lands inside an `<input>` — assert via the
    // value, not the text content.
    expect(getByDisplayValue('Solarium')).toBeInTheDocument();
  });
});
