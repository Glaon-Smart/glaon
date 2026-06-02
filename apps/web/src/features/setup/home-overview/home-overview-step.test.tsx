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

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { StrictMode, type ReactNode } from 'react';

import { ToastProvider } from '@glaon/ui';

import { HomeOverviewStep } from './home-overview-step';

// The step now reads the device's HA config on mount (#646) and saves
// the slice on Next. Mock fetch URL-aware: GET /ha-config returns the
// `haConfig` seed; POST /apply-ha returns the `apply` result.
interface FetchOverrides {
  readonly haConfig?: unknown;
  readonly apply?: { ok?: boolean };
  readonly applyStatus?: number;
}

function mockResponse(json: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  } as Response;
}

function installFetch(overrides: FetchOverrides = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown, init?: { method?: string }) => {
      const u = String(url);
      if (u.includes('/api/setup/ha-config')) {
        return Promise.resolve(mockResponse(overrides.haConfig ?? {}));
      }
      if (u.includes('/api/setup/apply-ha') && init?.method === 'POST') {
        return Promise.resolve(
          mockResponse(overrides.apply ?? { ok: true }, overrides.applyStatus),
        );
      }
      return Promise.reject(new TypeError(`unexpected fetch ${u}`));
    }),
  );
}

function wrap(node: ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

beforeEach(() => {
  installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HomeOverviewStep', () => {
  it('renders the title and the home name field', () => {
    const { container, getByTestId } = render(
      wrap(<HomeOverviewStep collected={{}} onNext={() => undefined} />),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Home Overview');
    // `data-testid` survives Tailwind reshuffles and keeps the
    // selector stable even when LocationPicker introduces sibling
    // text inputs (#590).
    expect(getByTestId('home-overview-home-name')).toBeInTheDocument();
  });

  it('renders Country above Location (#648 reorder)', () => {
    const { getByText } = render(
      wrap(<HomeOverviewStep collected={{}} onNext={() => undefined} />),
    );
    const country = getByText('Country');
    const location = getByText('Location');
    // Country's row precedes Location's row in document order.
    expect(
      country.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the language switcher in the header, outside the form, before the home name (#670)', () => {
    const { getByRole, getByTestId } = render(
      wrap(<HomeOverviewStep collected={{}} onNext={() => undefined} />),
    );
    // The switcher is label-less now (header chrome, not a FormRow): query
    // it by its accessible name (aria-label "Language").
    const language = getByRole('combobox', { name: 'Language' });
    const homeName = getByTestId('home-overview-home-name');
    // It lives in the header, so it precedes the home name field, and it is
    // NOT inside the <form>.
    expect(
      language.compareDocumentPosition(homeName) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(homeName.closest('form')).not.toBeNull();
    expect(language.closest('form')).toBeNull();
  });

  it('blocks submission when home name is empty and shows an inline error', () => {
    const onNext = vi.fn();
    const { getByRole, queryByRole } = render(
      wrap(<HomeOverviewStep collected={{}} onNext={onNext} />),
    );
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).not.toHaveBeenCalled();
    // The inline error renders via <p role="alert"> — Toast Rule
    // says local field validation stays inline, never Toast.
    expect(queryByRole('alert')).not.toBeNull();
  });

  it('saves the slice to the device, then advances with the merged partial', async () => {
    const onNext = vi.fn();
    const { getByRole, getByTestId } = render(
      wrap(<HomeOverviewStep collected={{}} onNext={onNext} />),
    );
    fireEvent.change(getByTestId('home-overview-home-name'), { target: { value: '  Olivia  ' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    const partial = onNext.mock.calls[0]?.[0] as { homeName?: string; unitSystem?: string };
    expect(partial.homeName).toBe('Olivia');
    expect(partial.unitSystem).toBe('metric');

    // The per-step save POSTed the slice to apply-ha.
    const fetchMock = global.fetch as unknown as { mock: { calls: unknown[][] } };
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/api/setup/apply-ha') &&
        (init as { method?: string } | undefined)?.method === 'POST',
    );
    expect(post).toBeDefined();
    const body = JSON.parse((post?.[1] as { body: string }).body) as Record<string, unknown>;
    expect(body.unitSystem).toBe('metric');
  });

  it('stays on the step and shows a Toast when the device save fails', async () => {
    installFetch({ apply: { ok: false } });
    const onNext = vi.fn();
    const { getByRole, getByTestId, findByRole } = render(
      wrap(<HomeOverviewStep collected={{}} onNext={onNext} />),
    );
    fireEvent.change(getByTestId('home-overview-home-name'), { target: { value: 'Olivia' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    // The danger Toast renders with role=status (aria-live polite); onNext
    // never fires because the save failed.
    expect(await findByRole('status')).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('treats a 503 (no HA Core configured) as a skip and advances', async () => {
    installFetch({ applyStatus: 503 });
    const onNext = vi.fn();
    const { getByRole, getByTestId } = render(
      wrap(<HomeOverviewStep collected={{}} onNext={onNext} />),
    );
    fireEvent.change(getByTestId('home-overview-home-name'), { target: { value: 'Olivia' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });

  it('hydrates form state from already-collected partial', () => {
    const { getByTestId } = render(
      wrap(
        <HomeOverviewStep
          collected={{ homeName: 'Glaon HQ', unitSystem: 'imperial' }}
          onNext={() => undefined}
        />,
      ),
    );
    const homeNameInput = getByTestId('home-overview-home-name') as HTMLInputElement;
    expect(homeNameInput.value).toBe('Glaon HQ');
  });

  it('seeds the home name from the device on a fresh visit', async () => {
    // apps/api returns the already-mapped (camelCase) seed.
    installFetch({ haConfig: { locationName: 'Evim', country: 'TR' } });
    const { getByTestId } = render(
      wrap(<HomeOverviewStep collected={{}} onNext={() => undefined} />),
    );
    const homeNameInput = getByTestId('home-overview-home-name') as HTMLInputElement;
    await waitFor(() => {
      expect(homeNameInput.value).toBe('Evim');
    });
  });

  it('applies the device seed under StrictMode — no seededRef drop (#676)', async () => {
    // Regression guard: StrictMode double-invokes the seed effect (mount →
    // unmount → remount). The old `seededRef` "run once" guard let the
    // first (cancelled) fetch win and blocked the live remount fetch, so the
    // form stayed blank in dev. Rendering inside <StrictMode> reproduces the
    // double-invoke; the seed must still apply.
    installFetch({ haConfig: { locationName: 'Evim' } });
    const { getByTestId } = render(
      <StrictMode>{wrap(<HomeOverviewStep collected={{}} onNext={() => undefined} />)}</StrictMode>,
    );
    const homeNameInput = getByTestId('home-overview-home-name') as HTMLInputElement;
    await waitFor(() => {
      expect(homeNameInput.value).toBe('Evim');
    });
  });

  it('preserves a previously saved location triple through submit', async () => {
    const onNext = vi.fn();
    const { getByRole, getByTestId } = render(
      wrap(
        <HomeOverviewStep
          collected={{
            homeName: 'Glaon HQ',
            location: 'Istanbul, Türkiye',
            latitude: 41.0082,
            longitude: 28.9784,
          }}
          onNext={onNext}
        />,
      ),
    );
    fireEvent.change(getByTestId('home-overview-home-name'), { target: { value: 'Glaon HQ' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
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
