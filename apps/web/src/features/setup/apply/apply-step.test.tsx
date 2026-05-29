// Apply step smoke (#597, #629). After #629 the Wi-Fi scan + picker
// moved to the Network step; the apply step now reads everything from
// `collected` and runs the commit ceremony: HA-settings push → hostname
// → per-interface IP → Wi-Fi handoff. The handoff modal + overlay sit
// under `wifi/handoff-*.tsx` and are exercised here (the modal opens
// after Save when the collected Wi-Fi is secured).

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryConfigStore } from '@glaon/core/config';
import { ToastProvider } from '@glaon/ui';

import { ConfigProvider } from '../../../config/config-provider';
import { isWrapped, wrapPassword } from '../wifi/wifi-crypto';
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

// /network/info — used by the commit's wireless-interface discovery.
const sampleNetworkInfo = {
  data: {
    interfaces: [
      { interface: 'wlan0', type: 'wireless', enabled: true },
      { interface: 'end0', type: 'ethernet', enabled: true },
    ],
  },
};

const haApplyOk = { ok: true, steps: [] };

/** Default URL-aware mock: apply-ha + network/info GET + any POST → ok. */
function defaultFetch(url: unknown): Promise<Response> {
  const u = String(url);
  if (u.includes('/api/setup/apply-ha')) {
    return Promise.resolve(mockFetchResponse({ json: haApplyOk }));
  }
  if (u.includes('/network/info'))
    return Promise.resolve(mockFetchResponse({ json: sampleNetworkInfo }));
  return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
}

/** Find a POST call whose URL contains `substr` (not the apply-ha POST). */
function findPost(substr: string): unknown[] | undefined {
  const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.find(
    ([url, init]) =>
      (init as { method?: string } | undefined)?.method === 'POST' && String(url).includes(substr),
  );
}

function postBody(call: unknown[] | undefined): Record<string, unknown> {
  return JSON.parse((call?.[1] as { body: string }).body) as Record<string, unknown>;
}

const reloadSpy = vi.fn();

beforeEach(() => {
  localStorage.clear();
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
  localStorage.clear();
});

describe('ApplyStep — summary', () => {
  it('renders the summary heading + a row per collected field', () => {
    const { container, getByText } = render(wrap(<ApplyStep collected={baseCollected} />));
    expect(container.querySelector('h1')?.textContent).toBe('Save and apply');
    expect(getByText('Olivia')).toBeInTheDocument();
    expect(getByText('TR')).toBeInTheDocument();
    expect(getByText('Metric')).toBeInTheDocument();
  });

  it('shows the hostname + Wi-Fi from collected network config', () => {
    const collected = {
      ...baseCollected,
      network: { hostname: 'glaon-wall' },
      wifi: { ssid: 'HomeWifi', passwordCipher: 'AES-GCM:abc' },
    };
    const { getByText } = render(wrap(<ApplyStep collected={collected} />));
    expect(getByText('glaon-wall')).toBeInTheDocument();
    // wifiSecured renders the "(secured)" summary variant (vs. the not-set
    // glyph) — robust to whether i18n interpolation runs in the test env.
    expect(getByText(/secured/)).toBeInTheDocument();
  });

  it('marks empty fields with the not-set glyph', () => {
    const { getAllByText } = render(wrap(<ApplyStep collected={{}} />));
    expect(getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('ApplyStep — commit', () => {
  it('commits home settings with no network/Wi-Fi and reloads (no handoff)', async () => {
    const configStore = new InMemoryConfigStore();
    const { getByRole } = render(wrap(<ApplyStep collected={baseCollected} />, configStore));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    expect(await configStore.isConfigured()).toBe(true);
    expect(findPost('/host/options')).toBeUndefined();
    expect(findPost('/network/interface/')).toBeUndefined();
  });

  it('pushes the hostname and a static IPv4 config, then reloads', async () => {
    const collected = {
      ...baseCollected,
      network: {
        hostname: 'glaon-wall',
        interfaces: [
          {
            name: 'end0',
            ipv4: {
              method: 'static' as const,
              address: ['192.168.1.50/24'],
              gateway: '192.168.1.1',
            },
            ipv6: { method: 'auto' as const },
          },
        ],
      },
    };
    const { getByRole } = render(wrap(<ApplyStep collected={collected} />));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    expect(postBody(findPost('/host/options'))).toMatchObject({ hostname: 'glaon-wall' });
    const ifaceBody = postBody(findPost('/network/interface/end0/update'));
    expect(ifaceBody).toMatchObject({ ipv4: { method: 'static', address: ['192.168.1.50/24'] } });
  });

  it('commits an unsecured Wi-Fi without opening the handoff modal', async () => {
    const collected = { ...baseCollected, wifi: { ssid: 'Guest', passwordCipher: '(unsecured)' } };
    const { getByRole } = render(wrap(<ApplyStep collected={collected} />));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    const body = postBody(findPost('/network/interface/wlan0/update'));
    expect(body).toMatchObject({ wifi: { auth: 'open', ssid: 'Guest' } });
  });

  it('opens the handoff modal for a secured Wi-Fi and commits the unwrapped PSK', async () => {
    const passwordCipher = await wrapPassword('secret');
    const collected = { ...baseCollected, wifi: { ssid: 'HomeWifi', passwordCipher } };
    const configStore = new InMemoryConfigStore();
    const { getByRole } = render(wrap(<ApplyStep collected={collected} />, configStore));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    const switchBtn = await waitFor(() => getByRole('button', { name: 'Switch network now' }));
    fireEvent.click(switchBtn);
    // Secured path defers the reload by 1500ms.
    await waitFor(
      () => {
        expect(reloadSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );
    const body = postBody(findPost('/network/interface/wlan0/update'));
    expect(body).toMatchObject({ wifi: { auth: 'wpa-psk', psk: 'secret', ssid: 'HomeWifi' } });
    // The persisted cipher stays wrapped (#595); plaintext never lands in the blob.
    const persistedCipher = (await configStore.get())?.wifi?.passwordCipher ?? '';
    expect(isWrapped(persistedCipher)).toBe(true);
  });

  it('surfaces a Toast and stays put when the Supervisor commit fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown, init?: { method?: string }) => {
        const u = String(url);
        if (u.includes('/api/setup/apply-ha')) {
          return Promise.resolve(mockFetchResponse({ json: haApplyOk }));
        }
        if (init?.method === 'POST' && u.includes('/network/interface/')) {
          return Promise.resolve(mockFetchResponse({ ok: false, status: 500 }));
        }
        if (u.includes('/network/info')) {
          return Promise.resolve(mockFetchResponse({ json: sampleNetworkInfo }));
        }
        return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
      }),
    );
    const collected = { ...baseCollected, wifi: { ssid: 'Guest', passwordCipher: '(unsecured)' } };
    const { getByRole, findByRole } = render(wrap(<ApplyStep collected={collected} />));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    expect(await findByRole('status')).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('aborts before the network push and toasts when the HA-settings push fails', async () => {
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
        return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
      }),
    );
    const collected = { ...baseCollected, wifi: { ssid: 'Guest', passwordCipher: '(unsecured)' } };
    const { getByRole, findByRole } = render(wrap(<ApplyStep collected={collected} />));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    expect(await findByRole('status')).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
    // The destructive network push never fired.
    expect(findPost('/network/interface/')).toBeUndefined();
  });
});

describe('ApplyStep — HA-less environment', () => {
  it('still completes setup when apply-ha is 503 (no HA Core configured)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const u = String(url);
        if (u.includes('/api/setup/apply-ha')) {
          return Promise.resolve(
            mockFetchResponse({ ok: false, status: 503, json: { error: 'no-ha' } }),
          );
        }
        return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
      }),
    );
    const configStore = new InMemoryConfigStore();
    const { getByRole } = render(wrap(<ApplyStep collected={baseCollected} />, configStore));
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    expect(await configStore.isConfigured()).toBe(true);
  });
});
