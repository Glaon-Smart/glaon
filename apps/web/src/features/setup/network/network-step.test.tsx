// Network step smoke (#629). Drives the load → render path and the
// hostname validation gate. The Select-driven static-IP reveal +
// per-field IP validation are unit-covered in `validation.test.ts` and
// walked end-to-end in the Playwright wizard smoke (react-aria's Select
// popup isn't reliably driveable in jsdom).

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@glaon/ui';

import { NetworkStep } from './network-step';

interface MockResponseInit {
  readonly ok?: boolean;
  readonly status?: number;
  readonly json?: unknown;
}

function mockFetchResponse({ ok = true, status = 200, json }: MockResponseInit): Response {
  return { ok, status, json: () => Promise.resolve(json) } as unknown as Response;
}

const sampleNetworkInfo = {
  data: {
    interfaces: [
      { interface: 'wlan0', type: 'wireless', ipv4: { method: 'auto' }, ipv6: { method: 'auto' } },
      {
        interface: 'end0',
        type: 'ethernet',
        ipv4: { method: 'static', address: ['192.168.1.50/24'], gateway: '192.168.1.1' },
        ipv6: { method: 'auto' },
      },
    ],
  },
};

const sampleAccessPoints = {
  data: {
    accesspoints: [
      { ssid: 'HomeWifi', mac: 'aa:bb:cc:00:00:01', signal: 70 },
      { ssid: 'Guest', mac: 'aa:bb:cc:00:00:02', signal: 55 },
    ],
  },
};

function readyFetch(url: unknown): Promise<Response> {
  const u = String(url);
  if (u.includes('/network/info'))
    return Promise.resolve(mockFetchResponse({ json: sampleNetworkInfo }));
  if (u.includes('/host/info')) {
    return Promise.resolve(mockFetchResponse({ json: { data: { hostname: 'glaon' } } }));
  }
  if (u.includes('/accesspoints')) {
    return Promise.resolve(mockFetchResponse({ json: sampleAccessPoints }));
  }
  return Promise.resolve(mockFetchResponse({ json: { result: 'ok' } }));
}

function renderStep(onNext = vi.fn()) {
  return {
    onNext,
    ...render(
      <ToastProvider>
        <NetworkStep collected={{}} onNext={onNext} />
      </ToastProvider>,
    ),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NetworkStep — ready', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => readyFetch(url)),
    );
  });

  it('seeds the hostname and renders an interface tab per interface', async () => {
    const { findByTestId, getByRole } = renderStep();
    const hostname = (await findByTestId('network-hostname')) as HTMLInputElement;
    expect(hostname.value).toBe('glaon');
    expect(getByRole('tab', { name: 'wlan0' })).toBeInTheDocument();
    expect(getByRole('tab', { name: 'end0' })).toBeInTheDocument();
  });

  it('lists scanned Wi-Fi networks under the wireless interface', async () => {
    const { findByText } = renderStep();
    expect(await findByText('HomeWifi')).toBeInTheDocument();
    expect(await findByText('Guest')).toBeInTheDocument();
  });

  it('advances with the collected network config, recombining IP + mask into CIDR', async () => {
    const { onNext, findByTestId, getByTestId } = renderStep();
    await findByTestId('network-hostname');
    fireEvent.click(getByTestId('network-next'));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
    const partial = onNext.mock.calls[0]?.[0] as {
      network?: {
        hostname?: string;
        interfaces?: { name: string; ipv4?: { address?: string[] } }[];
      };
    };
    expect(partial.network?.hostname).toBe('glaon');
    expect(partial.network?.interfaces?.map((i) => i.name)).toEqual(['wlan0', 'end0']);
    // end0's seeded static IP (192.168.1.50) + mask (255.255.255.0, from
    // the seeded /24) recombine into the CIDR the schema expects (#639).
    const end0 = partial.network?.interfaces?.find((i) => i.name === 'end0');
    expect(end0?.ipv4?.address).toEqual(['192.168.1.50/24']);
  });

  it('splits a seeded CIDR into an IP + dotted subnet mask on a static interface (#639)', async () => {
    const { findByRole, getByLabelText } = renderStep();
    // end0's IPv4 is static, so its panel auto-opens; the seeded
    // 192.168.1.50/24 shows as a plain IP + a dotted mask.
    fireEvent.click(await findByRole('tab', { name: 'end0' }));
    expect((getByLabelText('Subnet mask') as HTMLInputElement).value).toBe('255.255.255.0');
  });

  it('blocks Next and shows an inline error for an invalid hostname', async () => {
    const { onNext, findByTestId, getByTestId, findByText } = renderStep();
    const hostname = await findByTestId('network-hostname');
    fireEvent.change(hostname, { target: { value: 'bad host' } });
    fireEvent.click(getByTestId('network-next'));
    expect(await findByText(/1–63 letters/i)).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('NetworkStep — supervisor unavailable', () => {
  it('shows the unavailable notice and still advances on Next', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        if (String(url).includes('/network/info')) {
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
    const { onNext, findByText, getByTestId } = renderStep();
    expect(await findByText(/Network configuration isn't available/i)).toBeInTheDocument();
    fireEvent.click(getByTestId('network-next'));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledWith({});
    });
  });
});
