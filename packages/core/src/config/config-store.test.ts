import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { KeyValueBackend } from '../auth/token-store';

import {
  DEVICE_CONFIG_STORAGE_KEY,
  InMemoryConfigStore,
  KeyValueConfigStore,
} from './config-store';
import { DEVICE_CONFIG_SCHEMA_VERSION } from './types';

function makeMockBackend(): KeyValueBackend & { state: Map<string, string> } {
  const state = new Map<string, string>();
  return {
    state,
    get(key) {
      return Promise.resolve(state.get(key) ?? null);
    },
    set(key, value) {
      state.set(key, value);
      return Promise.resolve();
    },
    delete(key) {
      state.delete(key);
      return Promise.resolve();
    },
  };
}

describe('InMemoryConfigStore', () => {
  it('returns null and isConfigured=false before any write', async () => {
    const store = new InMemoryConfigStore();
    expect(await store.get()).toBeNull();
    expect(await store.isConfigured()).toBe(false);
  });

  it('round-trips a partial write and stamps schemaVersion', async () => {
    const store = new InMemoryConfigStore();
    await store.setPartial({ homeName: 'Olivia', country: 'TR' });
    const blob = await store.get();
    expect(blob).toEqual({
      schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
      homeName: 'Olivia',
      country: 'TR',
    });
  });

  it('shallow-merges successive setPartial calls', async () => {
    const store = new InMemoryConfigStore();
    await store.setPartial({ homeName: 'Olivia' });
    await store.setPartial({ country: 'TR', timezone: 'Europe/Istanbul' });
    expect(await store.get()).toEqual({
      schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
      homeName: 'Olivia',
      country: 'TR',
      timezone: 'Europe/Istanbul',
    });
  });

  it('round-trips a network block through setPartial and preserves it across merges', async () => {
    const store = new InMemoryConfigStore();
    const network = {
      hostname: 'glaon-wall',
      interfaces: [
        {
          name: 'end0',
          ipv4: { method: 'static' as const, address: ['192.168.1.50/24'], gateway: '192.168.1.1' },
          ipv6: { method: 'auto' as const },
        },
      ],
    };
    await store.setPartial({ network });
    await store.setPartial({ homeName: 'Olivia' });
    expect(await store.get()).toEqual({
      schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
      network,
      homeName: 'Olivia',
    });
  });

  it('markComplete stamps an ISO timestamp and flips isConfigured', async () => {
    const store = new InMemoryConfigStore();
    await store.setPartial({ homeName: 'Olivia' });
    expect(await store.isConfigured()).toBe(false);

    await store.markComplete();
    expect(await store.isConfigured()).toBe(true);
    const blob = await store.get();
    expect(blob?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('markComplete works from a fully empty state (only schemaVersion + completedAt)', async () => {
    const store = new InMemoryConfigStore();
    await store.markComplete();
    expect(await store.isConfigured()).toBe(true);
    const blob = await store.get();
    expect(Object.keys(blob ?? {}).sort()).toEqual(['completedAt', 'schemaVersion']);
  });

  it('markComplete is idempotent and refreshes the timestamp', async () => {
    const store = new InMemoryConfigStore();
    await store.markComplete();
    const first = (await store.get())?.completedAt;

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await store.markComplete();
    const second = (await store.get())?.completedAt;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('clear() drops the blob to null and isConfigured back to false', async () => {
    const store = new InMemoryConfigStore();
    await store.setPartial({ homeName: 'Olivia' });
    await store.markComplete();
    await store.clear();
    expect(await store.get()).toBeNull();
    expect(await store.isConfigured()).toBe(false);
  });

  it('clear() is idempotent when nothing is stored', async () => {
    const store = new InMemoryConfigStore();
    await store.clear();
    expect(await store.get()).toBeNull();
  });

  it('setPartial rejects values that fail schema validation', async () => {
    const store = new InMemoryConfigStore();
    // `country` is typed as string at compile time, but the schema regex
    // rejects lowercase / non-2-letter codes at runtime.
    await expect(store.setPartial({ country: 'lowercase' })).rejects.toThrow();
  });
});

describe('KeyValueConfigStore', () => {
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('persists under the device-config key as JSON', async () => {
    const backend = makeMockBackend();
    const store = new KeyValueConfigStore(backend);
    await store.setPartial({ homeName: 'Olivia' });
    const raw = backend.state.get(DEVICE_CONFIG_STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw ?? '{}')).toEqual({
      schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
      homeName: 'Olivia',
    });
  });

  it('round-trips through the backend', async () => {
    const backend = makeMockBackend();
    const store = new KeyValueConfigStore(backend);
    await store.setPartial({ homeName: 'Olivia', country: 'TR' });
    await store.markComplete();

    const fresh = new KeyValueConfigStore(backend);
    const blob = await fresh.get();
    expect(blob?.homeName).toBe('Olivia');
    expect(blob?.country).toBe('TR');
    expect(blob?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await fresh.isConfigured()).toBe(true);
  });

  it('returns null and isConfigured=false on a fresh backend', async () => {
    const store = new KeyValueConfigStore(makeMockBackend());
    expect(await store.get()).toBeNull();
    expect(await store.isConfigured()).toBe(false);
  });

  it('clears the key and returns null when the JSON is invalid', async () => {
    const backend = makeMockBackend();
    backend.state.set(DEVICE_CONFIG_STORAGE_KEY, 'not-json{');
    const store = new KeyValueConfigStore(backend);
    expect(await store.get()).toBeNull();
    expect(backend.state.has(DEVICE_CONFIG_STORAGE_KEY)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid JSON'),
      expect.anything(),
    );
  });

  it('clears the key and returns null when the schema mismatches', async () => {
    const backend = makeMockBackend();
    backend.state.set(
      DEVICE_CONFIG_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 99, unknownField: true }),
    );
    const store = new KeyValueConfigStore(backend);
    expect(await store.get()).toBeNull();
    expect(backend.state.has(DEVICE_CONFIG_STORAGE_KEY)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('schema mismatch'),
      expect.anything(),
    );
  });

  it('setPartial recovers from a corrupt blob and writes a fresh shape', async () => {
    const backend = makeMockBackend();
    backend.state.set(DEVICE_CONFIG_STORAGE_KEY, 'not-json{');
    const store = new KeyValueConfigStore(backend);
    await store.setPartial({ homeName: 'Olivia' });
    const blob = await store.get();
    expect(blob).toEqual({
      schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
      homeName: 'Olivia',
    });
  });

  it('clear() deletes the backend key and is idempotent', async () => {
    const backend = makeMockBackend();
    const store = new KeyValueConfigStore(backend);
    await store.setPartial({ homeName: 'Olivia' });
    await store.clear();
    expect(backend.state.has(DEVICE_CONFIG_STORAGE_KEY)).toBe(false);
    await store.clear();
    expect(backend.state.has(DEVICE_CONFIG_STORAGE_KEY)).toBe(false);
  });
});
