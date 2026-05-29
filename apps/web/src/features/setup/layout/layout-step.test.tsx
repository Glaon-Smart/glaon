// Smoke-level UI coverage. The reducer's correctness is tested
// exhaustively in `use-layout-state.test.ts`; here we verify the step
// seeds from the device HA layout (#638), the default state renders, the
// add-floor / add-room affordances dispatch into the reducer, and submit
// emits the structured `layout` blob.

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@glaon/ui';

import type { Layout } from '@glaon/core/config';

import { LayoutStep } from './layout-step';

function wrap(node: React.ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

function mockResponse(init: { ok?: boolean; status?: number; json?: unknown }): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(init.json),
  } as unknown as Response;
}

beforeEach(() => {
  // Default: HA Core not configured (503) → the step degrades silently to
  // a blank default floor. Tests that exercise seeding override this.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(mockResponse({ ok: false, status: 503, json: {} }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LayoutStep', () => {
  it('renders the title and the default single floor when the device has none', async () => {
    const { container, findByText } = render(
      wrap(<LayoutStep collected={{}} onNext={() => undefined} />),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Layout Setup');
    // After the 503, the editor seeds the EN default floor name.
    expect(await findByText('Ground Floor')).toBeInTheDocument();
  });

  it('seeds floors + rooms from the device HA layout (#638)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          mockResponse({
            json: {
              floors: [{ id: 'f1', name: 'Garage Floor', rooms: [{ id: 'r1', name: 'Workshop' }] }],
              unassigned: [{ id: 'r2', name: 'Patio' }],
            },
          }),
        ),
      ),
    );
    const onNext = vi.fn();
    const { findByText, getByRole, getByDisplayValue } = render(
      wrap(<LayoutStep collected={{}} onNext={onNext} />),
    );
    // The device floor pill + its room (in an input) render after the seed.
    expect(await findByText('Garage Floor')).toBeInTheDocument();
    expect(getByDisplayValue('Workshop')).toBeInTheDocument();
    // Submitting carries both the device floor and the unassigned area
    // (under the default-named floor).
    fireEvent.click(getByRole('button', { name: 'Next' }));
    const partial = onNext.mock.calls[0]?.[0] as { layout?: Layout };
    expect(partial.layout?.floors.map((f) => f.name)).toEqual(['Garage Floor', 'Ground Floor']);
    expect(partial.layout?.floors[1]?.rooms.map((r) => r.name)).toEqual(['Patio']);
  });

  it('submits the default single-floor layout on Next', async () => {
    const onNext = vi.fn();
    const { findByRole } = render(wrap(<LayoutStep collected={{}} onNext={onNext} />));
    fireEvent.click(await findByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    const partial = onNext.mock.calls[0]?.[0] as { layout?: Layout };
    expect(partial.layout?.floors).toHaveLength(1);
    expect(partial.layout?.floors[0]?.name).toBe('Ground Floor');
    expect(partial.layout?.floors[0]?.rooms).toEqual([]);
  });

  it('adds a second floor via the "Add floor" pill', async () => {
    const onNext = vi.fn();
    const { findByRole, getByRole } = render(wrap(<LayoutStep collected={{}} onNext={onNext} />));
    fireEvent.click(await findByRole('button', { name: /Add floor/i }));
    fireEvent.click(getByRole('button', { name: 'Next' }));
    const partial = onNext.mock.calls[0]?.[0] as { layout?: Layout };
    expect(partial.layout?.floors).toHaveLength(2);
    expect(partial.layout?.floors[1]?.rooms).toEqual([]);
  });

  it('adds a room via the empty-state CTA on the default floor', async () => {
    const onNext = vi.fn();
    const { findByRole, getByRole } = render(wrap(<LayoutStep collected={{}} onNext={onNext} />));
    fireEvent.click(await findByRole('button', { name: /Add your first room/i }));
    fireEvent.click(getByRole('button', { name: 'Next' }));
    const partial = onNext.mock.calls[0]?.[0] as { layout?: Layout };
    expect(partial.layout?.floors[0]?.rooms).toHaveLength(1);
    expect((partial.layout?.floors[0]?.rooms[0]?.name ?? '').length).toBeGreaterThan(0);
  });

  it('reuses a previously collected layout and skips the device read', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(mockResponse({ json: {} })));
    vi.stubGlobal('fetch', fetchSpy);
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
      wrap(<LayoutStep collected={{ layout }} onNext={() => undefined} />),
    );
    expect(container.textContent ?? '').toMatch(/Penthouse/);
    expect(getByDisplayValue('Solarium')).toBeInTheDocument();
    // collected.layout present → no device read.
    await waitFor(() => {
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
