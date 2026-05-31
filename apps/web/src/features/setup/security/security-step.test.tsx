import { fireEvent, render, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEVICE_CONFIG_SCHEMA_VERSION,
  InMemoryConfigStore,
  type DeviceConfig,
} from '@glaon/core/config';
import { ToastProvider } from '@glaon/ui';

import { ConfigProvider } from '../../../config/config-provider';
import { SecurityStep } from './security-step';

// The step reads the device's stored config via useDeviceConfig (#651) —
// pass `initialConfig` to simulate an already-configured device.
function wrap(node: ReactNode, initialConfig: DeviceConfig | null = null) {
  return (
    <ConfigProvider configStore={new InMemoryConfigStore()} initialConfig={initialConfig}>
      <ToastProvider>{node}</ToastProvider>
    </ConfigProvider>
  );
}

const configuredDevice: DeviceConfig = {
  schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
  adminUsername: 'olivia.admin',
  securityPinHash: 'a'.repeat(64),
};

describe('SecurityStep', () => {
  it('renders the title and both password fields', () => {
    const { container, getByText } = render(
      wrap(<SecurityStep collected={{}} onNext={() => undefined} />),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Device Security');
    expect(getByText('Password')).toBeInTheDocument();
    expect(getByText('Confirm password')).toBeInTheDocument();
  });

  it('blocks submission and shows required errors when both fields are empty', () => {
    const onNext = vi.fn();
    const { getByRole, getByText } = render(wrap(<SecurityStep collected={{}} onNext={onNext} />));
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).not.toHaveBeenCalled();
    // Required-field error renders as HintText via the PasswordInput
    // `error` prop (RAC slot="errorMessage" — no role=alert).
    expect(getByText(/Password is required/)).toBeInTheDocument();
  });

  it('rejects passwords shorter than 8 characters with a min-length error', () => {
    const onNext = vi.fn();
    const { container, getByRole, getByText } = render(
      wrap(<SecurityStep collected={{}} onNext={onNext} />),
    );
    const inputs = container.querySelectorAll('input[type="password"]');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'short' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'short' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).not.toHaveBeenCalled();
    expect(getByText(/use at least/i)).toBeInTheDocument();
  });

  it('rejects mismatched passwords with a mismatch error', () => {
    const onNext = vi.fn();
    const { container, getByRole, getByText } = render(
      wrap(<SecurityStep collected={{}} onNext={onNext} />),
    );
    const inputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'longenough1' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'differentpw1' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).not.toHaveBeenCalled();
    expect(getByText(/Passwords don't match/i)).toBeInTheDocument();
  });

  it('blocks submission and shows an error for an invalid username (#640)', () => {
    const onNext = vi.fn();
    const { container, getByRole, getByTestId, getByText } = render(
      wrap(<SecurityStep collected={{}} onNext={onNext} />),
    );
    // Valid passwords, but an invalid username (contains a space).
    const pw = container.querySelectorAll('input[type="password"]');
    fireEvent.change(pw[0] as HTMLInputElement, { target: { value: 'longenough1' } });
    fireEvent.change(pw[1] as HTMLInputElement, { target: { value: 'longenough1' } });
    fireEvent.change(getByTestId('security-username'), { target: { value: 'bad name' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).not.toHaveBeenCalled();
    expect(getByText(/3–32 characters/i)).toBeInTheDocument();
  });

  it('emits adminUsername + securityPinHash on a valid Next (#640)', async () => {
    const onNext = vi.fn();
    const { container, getByRole, getByTestId } = render(
      wrap(<SecurityStep collected={{}} onNext={onNext} />),
    );
    fireEvent.change(getByTestId('security-username'), { target: { value: 'admin.user' } });
    const inputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'correct horse battery' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'correct horse battery' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
    const partial = onNext.mock.calls[0]?.[0] as {
      adminUsername?: string;
      securityPinHash?: string;
    };
    expect(partial.adminUsername).toBe('admin.user');
    expect(partial.securityPinHash).toMatch(/^[0-9a-f]{64}$/);
    // Same input → same hash. Compute the expected hash directly so
    // the test catches any deviation from canonical SHA-256.
    const expectedDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('correct horse battery'),
    );
    const expectedHex = Array.from(new Uint8Array(expectedDigest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(partial.securityPinHash).toBe(expectedHex);
  });

  it('seeds the admin username from the stored device config (#651)', () => {
    const { getByTestId } = render(
      wrap(<SecurityStep collected={{}} onNext={() => undefined} />, configuredDevice),
    );
    expect((getByTestId('security-username') as HTMLInputElement).value).toBe('olivia.admin');
  });

  it('keeps the existing password when both fields are left blank (#651)', async () => {
    const onNext = vi.fn();
    const { getByRole } = render(
      wrap(<SecurityStep collected={{}} onNext={onNext} />, configuredDevice),
    );
    // Username is pre-seeded + valid; leave both password fields blank.
    fireEvent.click(getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
    const partial = onNext.mock.calls[0]?.[0] as {
      adminUsername?: string;
      securityPinHash?: string;
    };
    expect(partial.adminUsername).toBe('olivia.admin');
    // No new hash emitted → the terminal commit's merge keeps the stored one.
    expect(partial.securityPinHash).toBeUndefined();
  });

  it('still validates a newly entered password even when one already exists (#651)', () => {
    const onNext = vi.fn();
    const { container, getByRole, getByText } = render(
      wrap(<SecurityStep collected={{}} onNext={onNext} />, configuredDevice),
    );
    const inputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'short' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'short' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    expect(onNext).not.toHaveBeenCalled();
    expect(getByText(/use at least/i)).toBeInTheDocument();
  });
});
