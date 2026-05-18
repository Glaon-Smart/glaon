import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryConfigStore } from '@glaon/core/config';
import { ToastProvider } from '@glaon/ui';

import { ConfigProvider } from '../../../config/config-provider';
import { ReviewStep } from './review-step';

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

const reloadSpy = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload: reloadSpy },
  });
  reloadSpy.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ReviewStep — summary', () => {
  it('renders a row per collected field', () => {
    const { container, getByText } = render(wrap(<ReviewStep collected={baseCollected} />));
    expect(container.querySelector('h1')?.textContent).toBe('Final Review');
    expect(getByText('Olivia')).toBeInTheDocument();
    expect(getByText('TR')).toBeInTheDocument();
    expect(getByText('Metric')).toBeInTheDocument();
  });

  it('shows the Wi-Fi line as secured / open and hides the password', () => {
    const { container, queryByText } = render(
      wrap(
        <ReviewStep
          collected={{
            ...baseCollected,
            wifi: { ssid: 'Home', passwordCipher: 'plaintext-secret' },
          }}
        />,
      ),
    );
    // ICU rendering returns "Home (secured)" via the `{ssid}` slot;
    // assert against the summary list's text content directly so a
    // split across nodes doesn't trip getByText.
    expect(container.textContent ?? '').toMatch(/Home/);
    expect(container.textContent ?? '').toMatch(/secured/);
    // The plaintext value never appears in the summary.
    expect(queryByText(/plaintext-secret/)).toBeNull();
  });

  it('marks empty fields with the not-set glyph', () => {
    const { getAllByText } = render(wrap(<ReviewStep collected={{}} />));
    // Every row renders the "—" placeholder when its value is missing.
    expect(getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('ReviewStep — commit ceremony', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true } as Response)),
    );
  });

  it('commits without a dialog when no Wi-Fi was collected', async () => {
    const configStore = new InMemoryConfigStore();
    const { getByRole } = render(wrap(<ReviewStep collected={baseCollected} />, configStore));
    fireEvent.click(getByRole('button', { name: 'Complete setup' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    expect(await configStore.isConfigured()).toBe(true);
    const persisted = await configStore.get();
    expect(persisted?.homeName).toBe('Olivia');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('commits straight away for an unsecured Wi-Fi network and pushes the open auth payload', async () => {
    const configStore = new InMemoryConfigStore();
    const collected = {
      ...baseCollected,
      wifi: { ssid: 'Guest', passwordCipher: '(unsecured)' },
    };
    const { getByRole } = render(wrap(<ReviewStep collected={collected} />, configStore));
    fireEvent.click(getByRole('button', { name: 'Complete setup' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
    const body = JSON.parse((calls[0]?.[1] as { body: string }).body) as { wifi: { auth: string } };
    expect(body.wifi.auth).toBe('open');
  });

  it('opens a password dialog for a secured Wi-Fi network and commits after Connect', async () => {
    const configStore = new InMemoryConfigStore();
    const collected = {
      ...baseCollected,
      wifi: { ssid: 'Home', passwordCipher: 'old-cipher' },
    };
    const { getByRole } = render(wrap(<ReviewStep collected={collected} />, configStore));
    fireEvent.click(getByRole('button', { name: 'Complete setup' }));
    // RAC Modal renders into a portal — query the document body to
    // reach it, not the test container.
    const connect = await waitFor(() => getByRole('button', { name: 'Connect' }));
    expect((connect as HTMLButtonElement).disabled).toBe(true);
    const passwordInput = document.body.querySelector('input[type="password"]');
    expect(passwordInput).not.toBeNull();
    fireEvent.change(passwordInput as HTMLInputElement, { target: { value: 'fresh-secret' } });
    fireEvent.click(getByRole('button', { name: 'Connect' }));
    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    const persisted = await configStore.get();
    // The dialog's value overwrites whatever cipher was carried in.
    expect(persisted?.wifi?.passwordCipher).toBe('fresh-secret');
    // Supervisor body carries the wpa-psk auth + the fresh password.
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const body = JSON.parse((calls[0]?.[1] as { body: string }).body) as {
      wifi: { auth: string; psk: string };
    };
    expect(body.wifi.auth).toBe('wpa-psk');
    expect(body.wifi.psk).toBe('fresh-secret');
  });

  it('surfaces a Toast and stays on review when the Supervisor push fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)),
    );
    const configStore = new InMemoryConfigStore();
    const collected = {
      ...baseCollected,
      wifi: { ssid: 'Guest', passwordCipher: '(unsecured)' },
    };
    const { getByRole, findByRole } = render(
      wrap(<ReviewStep collected={collected} />, configStore),
    );
    fireEvent.click(getByRole('button', { name: 'Complete setup' }));
    expect(await findByRole('status')).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(await configStore.isConfigured()).toBe(false);
  });
});
