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

const sampleSupervisorPayload = {
  data: {
    interfaces: [
      {
        accesspoints: [
          { ssid: 'HomeWifi', auth: 'wpa-psk' },
          { ssid: 'Guest', auth: 'none' },
        ],
      },
    ],
  },
};

const reloadSpy = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload: reloadSpy },
  });
  reloadSpy.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(mockFetchResponse({ json: sampleSupervisorPayload }))),
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

describe('ApplyStep — standalone mode', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_APP_MODE', 'standalone');
  });

  it('renders the informational notice and commits without a wifi handoff', async () => {
    const configStore = new InMemoryConfigStore();
    const { getByRole, getByText } = render(
      wrap(<ApplyStep collected={baseCollected} />, configStore),
    );
    expect(getByText(/Wi-Fi setup is only available/i)).toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: 'Save and switch network' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    expect(await configStore.isConfigured()).toBe(true);
    // No supervisor call in standalone mode — fetch is mocked but
    // the wifi block short-circuits before posting.
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      calls.some(([, init]) => (init as { method?: string } | undefined)?.method === 'POST'),
    ).toBe(false);
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
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const postCall = calls.find(
      ([, init]) => (init as { method?: string } | undefined)?.method === 'POST',
    );
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
    expect(persisted?.wifi?.passwordCipher).toBe('fresh-secret');
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const postCall = calls.find(
      ([, init]) => (init as { method?: string } | undefined)?.method === 'POST',
    );
    const body = JSON.parse((postCall?.[1] as { body: string }).body) as {
      wifi: { auth: string; psk: string };
    };
    expect(body.wifi.auth).toBe('wpa-psk');
    expect(body.wifi.psk).toBe('fresh-secret');
  });

  it('surfaces a Toast and stays on the apply step when the Supervisor commit fails', async () => {
    // Scan succeeds; the network-update POST fails.
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve(mockFetchResponse({ json: sampleSupervisorPayload }));
        }
        return Promise.resolve(mockFetchResponse({ ok: false, status: 500 }));
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
