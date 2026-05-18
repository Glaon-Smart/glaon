import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@glaon/ui';

import { SecurityStep } from './security-step';

function wrap(node: React.ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

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

  it('hashes the password with SHA-256 and emits securityPinHash on Next', async () => {
    const onNext = vi.fn();
    const { container, getByRole } = render(wrap(<SecurityStep collected={{}} onNext={onNext} />));
    const inputs = container.querySelectorAll('input[type="password"]');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'correct horse battery' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'correct horse battery' } });
    fireEvent.click(getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
    const partial = onNext.mock.calls[0]?.[0] as { securityPinHash?: string };
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
});
