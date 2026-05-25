import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearWizardScratch, useWizardState, WIZARD_SCRATCH_KEY } from './use-wizard-state';

type StepId = 'home-overview' | 'layout' | 'security' | 'apply';

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
  // jsdom shares a single localStorage across tests in the same file;
  // wipe it so each case starts deterministic.
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('useWizardState — seed', () => {
  it('starts at initialStepId with empty collected when nothing is persisted', () => {
    const storage = inMemoryStorage();
    const { result } = renderHook(() =>
      useWizardState<StepId>({ initialStepId: 'home-overview', storage }),
    );
    expect(result.current.activeStepId).toBe('home-overview');
    expect(result.current.collected).toEqual({});
  });

  it('hydrates from storage when a fresh entry exists', () => {
    const storage = inMemoryStorage();
    storage.setItem(
      WIZARD_SCRATCH_KEY,
      JSON.stringify({
        collected: { homeName: 'Olivia', country: 'TR' },
        activeStepId: 'apply',
        updatedAt: Date.now(),
      }),
    );
    const { result } = renderHook(() =>
      useWizardState<StepId>({ initialStepId: 'home-overview', storage }),
    );
    expect(result.current.activeStepId).toBe('apply');
    expect(result.current.collected).toEqual({ homeName: 'Olivia', country: 'TR' });
  });

  it('drops a stale entry past the TTL and re-seeds from initialStepId', () => {
    const storage = inMemoryStorage();
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    storage.setItem(
      WIZARD_SCRATCH_KEY,
      JSON.stringify({
        collected: { homeName: 'Old' },
        activeStepId: 'apply',
        updatedAt: twoDaysAgo,
      }),
    );
    const { result } = renderHook(() =>
      useWizardState<StepId>({ initialStepId: 'home-overview', storage }),
    );
    expect(result.current.activeStepId).toBe('home-overview');
    expect(result.current.collected).toEqual({});
    // Stale entry should have been removed.
    expect(storage.getItem(WIZARD_SCRATCH_KEY)).toBeNull();
  });

  it('ignores a malformed entry', () => {
    const storage = inMemoryStorage();
    storage.setItem(WIZARD_SCRATCH_KEY, '{ not valid');
    const { result } = renderHook(() =>
      useWizardState<StepId>({ initialStepId: 'home-overview', storage }),
    );
    expect(result.current.activeStepId).toBe('home-overview');
    expect(result.current.collected).toEqual({});
  });

  it('bypassStorage=true skips read AND write paths', () => {
    const storage = inMemoryStorage();
    storage.setItem(
      WIZARD_SCRATCH_KEY,
      JSON.stringify({
        collected: { homeName: 'Persisted' },
        activeStepId: 'apply',
        updatedAt: Date.now(),
      }),
    );
    const { result } = renderHook(() =>
      useWizardState<StepId>({
        initialStepId: 'home-overview',
        bypassStorage: true,
        storage,
      }),
    );
    // Storage entry is ignored on read.
    expect(result.current.collected).toEqual({});
    expect(result.current.activeStepId).toBe('home-overview');
    // And writes don't persist either.
    act(() => {
      result.current.setCollected({ homeName: 'New' });
    });
    expect(storage.getItem(WIZARD_SCRATCH_KEY)).toContain('Persisted');
  });
});

describe('useWizardState — write-back', () => {
  it('persists collected updates to storage', () => {
    const storage = inMemoryStorage();
    const { result } = renderHook(() =>
      useWizardState<StepId>({ initialStepId: 'home-overview', storage }),
    );
    act(() => {
      result.current.setCollected({ homeName: 'Olivia' });
    });
    const raw = storage.getItem(WIZARD_SCRATCH_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}') as { collected: { homeName?: string } };
    expect(parsed.collected.homeName).toBe('Olivia');
  });

  it('persists activeStepId transitions', () => {
    const storage = inMemoryStorage();
    const { result } = renderHook(() =>
      useWizardState<StepId>({ initialStepId: 'home-overview', storage }),
    );
    act(() => {
      result.current.setActiveStepId('apply');
    });
    const raw = storage.getItem(WIZARD_SCRATCH_KEY);
    const parsed = JSON.parse(raw ?? '{}') as { activeStepId: string };
    expect(parsed.activeStepId).toBe('apply');
  });

  it('clear() removes the scratch entry', () => {
    const storage = inMemoryStorage();
    storage.setItem(
      WIZARD_SCRATCH_KEY,
      JSON.stringify({ collected: {}, activeStepId: 'apply', updatedAt: Date.now() }),
    );
    const { result } = renderHook(() =>
      useWizardState<StepId>({ initialStepId: 'home-overview', storage }),
    );
    act(() => {
      result.current.clear();
    });
    expect(storage.getItem(WIZARD_SCRATCH_KEY)).toBeNull();
  });
});

describe('clearWizardScratch (standalone)', () => {
  it('removes the scratch entry from the default window.localStorage', () => {
    window.localStorage.setItem(
      WIZARD_SCRATCH_KEY,
      JSON.stringify({ collected: {}, activeStepId: 'apply', updatedAt: Date.now() }),
    );
    clearWizardScratch();
    expect(window.localStorage.getItem(WIZARD_SCRATCH_KEY)).toBeNull();
  });
});
