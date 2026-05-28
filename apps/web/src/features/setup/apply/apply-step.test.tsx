// Combined smoke for the merged Apply step (#597). Folds the
// previous wifi-step and review-step test coverage into one file
// since the two screens collapsed into one. The handoff modal +
// overlay sit under `wifi/handoff-*.tsx` and are exercised end-to-
// end here (the modal opens after the user clicks Save and the
// network is secured).

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryConfigStore } from '@glaon/core/config';
import { ToastProvider } from '@glaon/ui';

import { ConfigProvider } from '../../../config/config-provider';
import { isWrapped } from '../wifi/wifi-crypto';
import { ApplyStep } from './apply-step';

interface MockResponseInit {
  readonly ok?: boolean;
  readonly status?: number;
  readonly json?: unknown;
}

function mockFetchResponse({ ok = true, status = 200, json }: MockResponseInit): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(json),
  } as unknown as Response;
}

function wrap(node: React.ReactNode, configStore = new InMemoryConfigStore()) {
  return (
    <ConfigProvider configStore={configStore}>
      <ToastProvider>{node}</ToastProvider>
    </ConfigProvider>
  );
}

const baseCollected = {
  homeName: 'Olivia',
  country: 'TR',
  unitSystem: 'metric' as const,
};

// #622 — /network/info carries interfaces only (for wireless-interface
// discovery); the AP list comes from the accesspoints endpoint and has
// no `auth` field (signal only).
const sampleNetworkInfo = {
  data: {
    interfaces: [
      { interface: 'wlan0', type: 'wireless', enabled: true },
      { interface: 'end0', type: 'ethernet', enabled: true },
    ],
  },
};

const sampleAccessPoints = {
  data: {
    accesspoints: [
      { ssid: 'HomeWifi', mac: 'aa:bb:cc:00:00:01', signal: 70, mode: 'infrastructure' },
      { ssid: 'Guest', mac: 'aa:bb:cc:00:00:02', signal: 55, mode: 'infrastructure' },
    ],
  },
};

/** Default success response for the HA-settings push (#617). */
const haApplyOk = { ok: true, steps: [] };

/** Route a GET network request to the right canned payload, else null. */
function networkScanResponse(url: string): Response | null {
  if (url.includes('/network/info')) return mockFetchResponse({ json: sampleNetworkInfo });
  if (url.includes('/accesspoints')) return mockFetchResponse({ json: sampleAccessPoints });
  return null;
}

/**
 * URL-aware default mock. The wizard's scan is two GETs (/network/info
 * then /network/interface/wlan0/accesspoints); the commit fires
 * /api/setup/apply-ha then the supervisor update POST. Route each so one
 * doesn't get another's payload.
 */
function defaultFetch(url: unknown): Promise<Response> {
  const u = String(url);
  if (u.includes('/api/setup/apply-ha')) {
    return Promise.resolve(mockFetchResponse({ json: haApplyOk }));
  }
  const scan = networkScanResponse(u);
  if (scan !== null) return Promise.resolve(scan);
  // Update POST (or anything else) → ok.
  return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
}

/** Find the supervisor wifi-update POST specifically (not the apply-ha POST). */
function findWifiPost(): unknown[] | undefined {
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.find(
    ([url, init]) =>
      (init as { method?: string } | undefined)?.method === 'POST' &&
      String(url).includes('/hassio/'),
  );
}

const reloadSpy = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload: reloadSpy },
  });
  reloadSpy.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) => defaultFetch(url)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('ApplyStep — summary', () => {
  it('renders the summary heading + a row per collected field', () => {
    const { container, getByText } = render(wrap(<ApplyStep collected={baseCollected} />));
    expect(container.querySelector('h1')?.textContent).toBe('Save and apply');
    expect(getByText('Olivia')).toBeInTheDocument();
    expect(getByText('TR')).toBeInTheDocument();
    expect(getByText('Metric')).toBeInTheDocument();
  });

  it('marks empty fields with the not-set glyph', () => {
    const { getAllByText } = render(wrap(<ApplyStep collected={{}} />));
    expect(getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('ApplyStep — Wi-Fi scan unavailable (503)', () => {
  // #619: availability is server-driven, not a build flag. When the
  // network-info endpoint answers 503 (supervisor-not-configured) the
  // Wi-Fi block degrades to an informational notice and the user can
  // commit without a network switch — the HA-less dev environment.
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const u = String(url);
        // Every Supervisor + HA-settings path 503s (HA-less env).
        if (u.includes('/api/hassio/network/') || u.includes('/api/setup/apply-ha')) {
          return Promise.resolve(
            mockFetchResponse({
              ok: false,
              status: 503,
              json: { error: 'supervisor-not-configured' },
            }),
          );
        }
        return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
      }),
    );
  });

  it('renders the informational notice and commits without a wifi handoff', async () => {
    const configStore = new InMemoryConfigStore();
    const { getByRole, findByText } = render(
      wrap(<ApplyStep collected={baseCollected} />, configStore),
    );
    expect(await findByText(/Wi-Fi scanning isn't available/i)).toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    expect(await configStore.isConfigured()).toBe(true);
    // No supervisor wifi-update POST — the wifi block had nothing to
    // commit (the HA-settings push 503s to a silent skip).
    expect(findWifiPost()).toBeUndefined();
  });
});

describe('ApplyStep — populated mode', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_APP_MODE', 'ingress');
  });

  it('renders one card per SSID returned by the scan', async () => {
    const { findByText } = render(wrap(<ApplyStep collected={baseCollected} />));
    expect(await findByText('HomeWifi')).toBeInTheDocument();
    expect(await findByText('Guest')).toBeInTheDocument();
  });

  it('blocks Save until a network is picked', async () => {
    const { findByText, getByRole } = render(wrap(<ApplyStep collected={baseCollected} />));
    await findByText('HomeWifi');
    const cta = getByRole('button', { name: 'Save and switch network' }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('commits an unsecured network without opening the handoff modal', async () => {
    const configStore = new InMemoryConfigStore();
    const { findByText, getByRole } = render(
      wrap(<ApplyStep collected={baseCollected} />, configStore),
    );
    fireEvent.click(await findByText('Guest'));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    const postCall = findWifiPost();
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall?.[1] as { body: string }).body) as {
      wifi: { auth: string };
    };
    expect(body.wifi.auth).toBe('open');
  });

  it('opens the HandoffModal for a secured network and commits after Switch network now', async () => {
    const configStore = new InMemoryConfigStore();
    const { findByText, getByRole } = render(
      wrap(<ApplyStep collected={baseCollected} />, configStore),
    );
    fireEvent.click(await findByText('HomeWifi'));
    // Inline password input below the wifi list.
    const inlinePassword = document.body.querySelector('input[type="password"]');
    if (inlinePassword === null) throw new Error('expected inline password input');
    fireEvent.change(inlinePassword, { target: { value: 'inline-pass' } });
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    // Modal opens; the "Switch network now" button is the confirm.
    const switchBtn = await waitFor(() => getByRole('button', { name: 'Switch network now' }));
    expect((switchBtn as HTMLButtonElement).disabled).toBe(true);
    // Re-type the password in the modal (typo guard).
    const modalPassword = document.body.querySelectorAll('input[type="password"]')[1];
    if (modalPassword === undefined) throw new Error('expected modal password input');
    fireEvent.change(modalPassword, { target: { value: 'fresh-secret' } });
    fireEvent.click(getByRole('button', { name: 'Switch network now' }));
    // Secured path defers the reload by 1500ms.
    await waitFor(
      () => {
        expect(reloadSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );
    const persisted = await configStore.get();
    // #595 — the persisted cipher is AES-GCM wrapped, not the
    // raw modal password. Asserting on the wrap shape only because
    // the apply step's post-commit cleanup intentionally drops the
    // wrap key from storage; an unwrap here would race a fresh key
    // and fail. The wrap → unwrap round-trip is exhaustively
    // covered by `wifi-crypto.test.ts`.
    const persistedCipher = persisted?.wifi?.passwordCipher ?? '';
    expect(isWrapped(persistedCipher)).toBe(true);
    expect(persistedCipher).not.toBe('fresh-secret');
    const postCall = findWifiPost();
    const body = JSON.parse((postCall?.[1] as { body: string }).body) as {
      wifi: { auth: string; psk: string };
    };
    expect(body.wifi.auth).toBe('wpa-psk');
    expect(body.wifi.psk).toBe('fresh-secret');
  });

  it('surfaces a Toast and stays on the apply step when the Supervisor commit fails', async () => {
    // Scan + HA-settings push succeed; the supervisor wifi-update POST fails.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown, init?: { method?: string }) => {
        const u = String(url);
        if (u.includes('/api/setup/apply-ha')) {
          return Promise.resolve(mockFetchResponse({ json: haApplyOk }));
        }
        if (init?.method === 'POST' && u.includes('/hassio/')) {
          return Promise.resolve(mockFetchResponse({ ok: false, status: 500 }));
        }
        const scan = networkScanResponse(u);
        if (scan !== null) return Promise.resolve(scan);
        return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
      }),
    );
    const { findByText, getByRole, findByRole } = render(
      wrap(<ApplyStep collected={baseCollected} />),
    );
    fireEvent.click(await findByText('Guest'));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    expect(await findByRole('status')).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('aborts before the wifi handoff and toasts when the HA-settings push fails', async () => {
    // HA-settings push reports a partial failure; the wizard must not
    // switch wifi (no /hassio/ POST) and must stay on the apply step.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const u = String(url);
        if (u.includes('/api/setup/apply-ha')) {
          return Promise.resolve(
            mockFetchResponse({
              json: { ok: false, steps: [{ step: 'core', ok: false, error: 'boom' }] },
            }),
          );
        }
        const scan = networkScanResponse(u);
        if (scan !== null) return Promise.resolve(scan);
        return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
      }),
    );
    const { findByText, getByRole, findByRole } = render(
      wrap(<ApplyStep collected={baseCollected} />),
    );
    fireEvent.click(await findByText('Guest'));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    expect(await findByRole('status')).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
    // Crucially, the destructive wifi switch never fired.
    expect(findWifiPost()).toBeUndefined();
  });
});

describe('ApplyStep — error path', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_APP_MODE', 'ingress');
  });

  it('surfaces a Toast when the network scan fails and renders an inline retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    const { findByRole, findByText } = render(wrap(<ApplyStep collected={baseCollected} />));
    await waitFor(async () => {
      expect(await findByRole('status')).toBeInTheDocument();
    });
    expect(await findByText(/We couldn't reach the Home Assistant/i)).toBeInTheDocument();
  });
});
