import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@glaon/ui';

import { WifiStep } from './wifi-step';

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

function wrap(node: React.ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(mockFetchResponse({ json: sampleSupervisorPayload }))),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('WifiStep — standalone mode', () => {
  it('renders the informational notice and lets Next advance with no selection', () => {
    vi.stubEnv('VITE_APP_MODE', 'standalone');
    const onNext = vi.fn();
    const { getByRole, getByText } = render(wrap(<WifiStep collected={{}} onNext={onNext} />));
    expect(getByText(/Wi-Fi setup is only available/i)).toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext.mock.calls[0]?.[0]).toEqual({});
  });
});

describe('WifiStep — populated mode', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_APP_MODE', 'ingress');
  });

  it('fetches the network list and renders one card per SSID', async () => {
    const { findAllByRole } = render(wrap(<WifiStep collected={{}} onNext={() => undefined} />));
    const cards = await findAllByRole('button', { name: /WIFI|HomeWifi|Guest/ });
    // Two networks + the Next button match the role pattern; assert the
    // two cards rendered with the network titles.
    const cardLabels = cards.map((el) => el.textContent ?? '');
    expect(cardLabels.some((l) => l.includes('HomeWifi'))).toBe(true);
    expect(cardLabels.some((l) => l.includes('Guest'))).toBe(true);
  });

  it('blocks Next until a network is selected', async () => {
    const onNext = vi.fn();
    const { findByText, getByRole } = render(wrap(<WifiStep collected={{}} onNext={onNext} />));
    await findByText('HomeWifi');
    const next = getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('requires a password for secured networks and emits ssid + cipher on Next', async () => {
    const onNext = vi.fn();
    const { findByText, getByRole, container } = render(
      wrap(<WifiStep collected={{}} onNext={onNext} />),
    );
    fireEvent.click(await findByText('HomeWifi'));
    const passwordInput = container.querySelector('input[type="password"]');
    expect(passwordInput).not.toBeNull();
    if (passwordInput === null) return;
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext.mock.calls[0]?.[0]).toEqual({
      wifi: { ssid: 'HomeWifi', passwordCipher: 'secret123' },
    });
  });

  it('skips the password field for unsecured networks and uses a placeholder cipher', async () => {
    const onNext = vi.fn();
    const { findByText, getByRole, container } = render(
      wrap(<WifiStep collected={{}} onNext={onNext} />),
    );
    fireEvent.click(await findByText('Guest'));
    // No password input renders for the unsecured pick.
    expect(container.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext.mock.calls[0]?.[0]).toEqual({
      wifi: { ssid: 'Guest', passwordCipher: '(unsecured)' },
    });
  });
});

describe('WifiStep — error path', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_APP_MODE', 'ingress');
  });

  it('surfaces a danger Toast (role=status) when the scan fails and offers a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    const { findByRole, findByText } = render(
      wrap(<WifiStep collected={{}} onNext={() => undefined} />),
    );
    // Toast renders with role=status (per the API Error Toast Rule).
    await waitFor(async () => {
      expect(await findByRole('status')).toBeInTheDocument();
    });
    // Retry affordance — Toast also renders a "Try again" button, so
    // `findByText` would over-match; pick the inline body copy that
    // sits above the inline retry button.
    expect(await findByText(/We couldn't reach the Home Assistant/i)).toBeInTheDocument();
  });
});

describe('WifiStep — empty mode', () => {
  it('shows the empty notice + retry when the Supervisor returns no APs', async () => {
    vi.stubEnv('VITE_APP_MODE', 'ingress');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          mockFetchResponse({ json: { data: { interfaces: [{ accesspoints: [] }] } } }),
        ),
      ),
    );
    const { findByText } = render(wrap(<WifiStep collected={{}} onNext={() => undefined} />));
    expect(await findByText(/No Wi-Fi networks found/i)).toBeInTheDocument();
  });
});
