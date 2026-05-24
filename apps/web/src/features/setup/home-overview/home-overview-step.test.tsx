// Smoke-level coverage. The Phase 2 picker trio
// (CountrySelect / TimezoneSelect / LocationPicker) carries its own
// detailed test surface in `packages/ui` — these assertions just
// verify the wizard step renders them and submits the merged blob.
//
// `react-map-gl/maplibre` is mocked because MapLibre tries to call
// `HTMLCanvasElement.getContext` during mount, which jsdom doesn't
// implement. We don't need real map rendering here — the smoke is
// over the wizard step's form contract, not the map's pixels (those
// are owned by `packages/ui`'s Storybook + Chromatic).

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// jsdom doesn't implement `HTMLCanvasElement.getContext`; MapLibre
// tries to call it on mount. We don't need real map rendering in
// this smoke — return a minimal stub so the constructor doesn't
// throw + so the noisy "Not implemented" log stops drowning the
// test output.
// `as unknown as never` lets the stub assignment satisfy the
// overloaded `getContext` signature without enumerating every
// context flavour (2D / WebGL / bitmap-renderer / WebGL2 …).
HTMLCanvasElement.prototype.getContext = ((): CanvasRenderingContext2D =>
  ({
    canvas: document.createElement('canvas'),
    fillRect: () => undefined,
    clearRect: () => undefined,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => undefined,
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: () => undefined,
    drawImage: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    measureText: () => ({ width: 0 }),
    translate: () => undefined,
    scale: () => undefined,
    rotate: () => undefined,
    arc: () => undefined,
  }) as unknown as CanvasRenderingContext2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;

import { HomeOverviewStep } from './home-overview-step';

describe('HomeOverviewStep', () => {
  it('renders the title and the home name field', () => {
    const { container, getByTestId } = render(
      <HomeOverviewStep collected={{}} onNext={() => undefined} />,
    );
    expect(container.querySelector('h1')?.textContent).toBe('Home Overview');
    // `data-testid` survives Tailwind reshuffles and keeps the
    // selector stable even when LocationPicker introduces sibling
    // text inputs (#590).
    expect(getByTestId('home-overview-home-name')).toBeInTheDocument();
  });

  it('blocks submission when home name is empty and shows an inline error', () => {
    const onNext = vi.fn();
    const { getByRole, queryByRole } = render(<HomeOverviewStep collected={{}} onNext={onNext} />);
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).not.toHaveBeenCalled();
    // The inline error renders via <p role="alert"> — Toast Rule
    // says local field validation stays inline, never Toast.
    expect(queryByRole('alert')).not.toBeNull();
  });

  it('submits trimmed home name + defaults when the form is filled', () => {
    const onNext = vi.fn();
    const { getByRole, getByTestId } = render(<HomeOverviewStep collected={{}} onNext={onNext} />);
    const homeNameInput = getByTestId('home-overview-home-name') as HTMLInputElement;
    fireEvent.change(homeNameInput, { target: { value: '  Olivia  ' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    const partial = onNext.mock.calls[0]?.[0] as {
      homeName?: string;
      unitSystem?: string;
      location?: string;
      latitude?: number;
      longitude?: number;
    };
    expect(partial.homeName).toBe('Olivia');
    expect(partial.unitSystem).toBe('metric');
    // No location interaction → these fields stay out of the partial.
    expect(partial.location).toBeUndefined();
    expect(partial.latitude).toBeUndefined();
    expect(partial.longitude).toBeUndefined();
  });

  it('hydrates form state from already-collected partial', () => {
    const { getByTestId } = render(
      <HomeOverviewStep
        collected={{ homeName: 'Glaon HQ', unitSystem: 'imperial' }}
        onNext={() => undefined}
      />,
    );
    const homeNameInput = getByTestId('home-overview-home-name') as HTMLInputElement;
    expect(homeNameInput.value).toBe('Glaon HQ');
  });

  it('preserves a previously saved location triple through submit', () => {
    const onNext = vi.fn();
    const { getByRole, getByTestId } = render(
      <HomeOverviewStep
        collected={{
          homeName: 'Glaon HQ',
          location: 'Istanbul, Türkiye',
          latitude: 41.0082,
          longitude: 28.9784,
        }}
        onNext={onNext}
      />,
    );
    // No interaction with the picker — just submit and confirm the
    // hydrated triple flows back through.
    fireEvent.change(getByTestId('home-overview-home-name'), {
      target: { value: 'Glaon HQ' },
    });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    const partial = onNext.mock.calls[0]?.[0] as {
      location?: string;
      latitude?: number;
      longitude?: number;
    };
    expect(partial.location).toBe('Istanbul, Türkiye');
    expect(partial.latitude).toBeCloseTo(41.0082);
    expect(partial.longitude).toBeCloseTo(28.9784);
  });
});
