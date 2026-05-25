import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearDeviceKey, isWrapped, unwrapPassword, wrapPassword } from './wifi-crypto';

// Node's `webcrypto.subtle` is API-compatible with `window.crypto.subtle`
// and is the easiest way to exercise the helper without leaning on
// jsdom's somewhat-incomplete crypto shim.
const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const getRandomValues = webcrypto.getRandomValues.bind(webcrypto) as typeof crypto.getRandomValues;

function inMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => map.set(k, v),
  };
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('wifi-crypto — wrap/unwrap roundtrip', () => {
  it('round-trips a typical WPA-PSK password', async () => {
    const storage = inMemoryStorage();
    const cipher = await wrapPassword('correct-horse-battery-staple', {
      storage,
      subtle,
      getRandomValues,
    });
    expect(cipher.startsWith('AES-GCM:')).toBe(true);
    expect(isWrapped(cipher)).toBe(true);
    const plain = await unwrapPassword(cipher, { storage, subtle, getRandomValues });
    expect(plain).toBe('correct-horse-battery-staple');
  });

  it('produces a different cipher each call (random IV) but unwraps to the same plaintext', async () => {
    const storage = inMemoryStorage();
    const a = await wrapPassword('hunter2', { storage, subtle, getRandomValues });
    const b = await wrapPassword('hunter2', { storage, subtle, getRandomValues });
    expect(a).not.toBe(b); // IV differs.
    expect(await unwrapPassword(a, { storage, subtle, getRandomValues })).toBe('hunter2');
    expect(await unwrapPassword(b, { storage, subtle, getRandomValues })).toBe('hunter2');
  });

  it('handles non-ASCII passwords (Turkish + emoji)', async () => {
    const storage = inMemoryStorage();
    const plaintext = 'Şifre-123-🔒';
    const cipher = await wrapPassword(plaintext, { storage, subtle, getRandomValues });
    expect(await unwrapPassword(cipher, { storage, subtle, getRandomValues })).toBe(plaintext);
  });

  it('reuses the persisted key across calls so unwrap survives a fresh module-load', async () => {
    const storage = inMemoryStorage();
    const cipher = await wrapPassword('abc123', { storage, subtle, getRandomValues });
    // Simulate a fresh boot — same storage, but no in-process cache.
    const plain = await unwrapPassword(cipher, { storage, subtle, getRandomValues });
    expect(plain).toBe('abc123');
  });
});

describe('wifi-crypto — sentinel passthrough', () => {
  it('passes the empty string through unchanged on both wrap and unwrap', async () => {
    const storage = inMemoryStorage();
    expect(await wrapPassword('', { storage, subtle, getRandomValues })).toBe('');
    expect(await unwrapPassword('', { storage, subtle, getRandomValues })).toBe('');
  });

  it('passes the `(unsecured)` sentinel through unchanged', async () => {
    const storage = inMemoryStorage();
    expect(await wrapPassword('(unsecured)', { storage, subtle, getRandomValues })).toBe(
      '(unsecured)',
    );
    expect(await unwrapPassword('(unsecured)', { storage, subtle, getRandomValues })).toBe(
      '(unsecured)',
    );
  });

  it('treats an already-wrapped value as idempotent on wrap', async () => {
    const storage = inMemoryStorage();
    const cipher = await wrapPassword('once', { storage, subtle, getRandomValues });
    const reWrapped = await wrapPassword(cipher, { storage, subtle, getRandomValues });
    expect(reWrapped).toBe(cipher);
  });

  it('treats a plaintext-shaped value as already-plain on unwrap', async () => {
    const storage = inMemoryStorage();
    const result = await unwrapPassword('not-wrapped', { storage, subtle, getRandomValues });
    expect(result).toBe('not-wrapped');
  });
});

describe('wifi-crypto — clearDeviceKey', () => {
  it('removes the persisted key so the next wrap regenerates', async () => {
    const storage = inMemoryStorage();
    await wrapPassword('abc', { storage, subtle, getRandomValues });
    clearDeviceKey(storage);
    // Wrapping again creates a NEW key, so an old cipher cannot
    // unwrap with the new key (sanity test the key rotation).
    const oldCipher = await wrapPassword('abc', { storage, subtle, getRandomValues });
    clearDeviceKey(storage);
    await expect(unwrapPassword(oldCipher, { storage, subtle, getRandomValues })).rejects.toThrow();
  });
});

describe('isWrapped', () => {
  it('detects the wrap prefix', () => {
    expect(isWrapped('AES-GCM:abc')).toBe(true);
    expect(isWrapped('plaintext')).toBe(false);
    expect(isWrapped('')).toBe(false);
    expect(isWrapped('(unsecured)')).toBe(false);
  });
});
