// Wizard scratch-state persistence (#595). Before this hook the
// SetupRoute held `collected` + `activeStepId` in `useState` only,
// which meant a browser refresh — or, more importantly, the Wi-Fi
// handoff disconnect after the user clicks Save and switch network
// (#594 / #596 / #599) — restarted the wizard at step 1.
//
// With the hook every `setCollected` / `setActiveStepId` round-
// trips through `localStorage` under `glaon.wizard.scratch`. On
// the next mount we hydrate from the same key as long as the
// entry is fresh (≤ TTL). The apply step's `markComplete()`
// pathway clears the scratch entry so a completed device never
// rehydrates a stale wizard run.
//
// The scratch key is **separate** from `glaon.device-config`:
//
//   - `glaon.device-config` (peekSync via WebConfigStore) is the
//     "the device is configured" signal SetupGate reads to skip
//     the wizard entirely.
//   - `glaon.wizard.scratch` is the in-flight wizard's state.
//     SetupGate doesn't read it; only SetupRoute does, after the
//     gate has already decided to render the wizard.
//
// The two never collide — completion fills the device-config blob
// and clears the scratch entry in the same code path.
//
// Per CLAUDE.md's Security-First Rules the scratch entry must not
// carry plaintext credentials. The Wi-Fi password is wrapped via
// `wifi-crypto.ts` before it lands in `collected.wifi.passwordCipher`,
// which is the only credential-shaped field the wizard collects;
// every other field (homeName, country, etc.) is non-sensitive.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DeviceConfigInput } from '@glaon/core/config';

export const WIZARD_SCRATCH_KEY = 'glaon.wizard.scratch';

/**
 * Hours after which a scratch entry is considered stale. A
 * wizard that takes more than this to walk is almost certainly
 * abandoned; honouring stale data risks restoring a setup the
 * user has long forgotten about.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

interface ScratchEntry<TStepId extends string> {
  readonly collected: DeviceConfigInput;
  readonly activeStepId: TStepId;
  readonly updatedAt: number;
}

interface UseWizardStateOptions<TStepId extends string> {
  /** Step the wizard should land on with no persisted state. */
  readonly initialStepId: TStepId;
  /**
   * When true, the hook acts as a plain `useState` pair — no read
   * from / write to storage, no clear() side-effects. The signal a
   * test (or another bypass-capable caller) wants the wizard to
   * start fresh at `initialStepId` without honouring any persisted
   * scratch entry.
   */
  readonly bypassStorage?: boolean;
  /** Override the storage layer in tests; defaults to window.localStorage. */
  readonly storage?: Storage;
  /** Override clock in tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * useState-equivalent contract over the wizard scratch key.
 *
 * Returned `setCollected` accepts the same signature as `useState`'s
 * (`SetStateAction<T>`). Returned `setActiveStepId` is a plain
 * setter. Returned `clear()` removes the scratch entry — call it
 * from the apply step right after `markComplete()` succeeds.
 */
export function useWizardState<TStepId extends string>(
  opts: UseWizardStateOptions<TStepId>,
): {
  readonly collected: DeviceConfigInput;
  readonly activeStepId: TStepId;
  readonly setCollected: (
    next: DeviceConfigInput | ((prev: DeviceConfigInput) => DeviceConfigInput),
  ) => void;
  readonly setActiveStepId: (next: TStepId) => void;
  readonly clear: () => void;
} {
  const storage = opts.storage ?? safeLocalStorage();
  const now = opts.now ?? Date.now;
  const initialStepId = opts.initialStepId;
  const bypassStorage = opts.bypassStorage === true;

  const initial = useMemo<ScratchEntry<TStepId>>(() => {
    if (!bypassStorage) {
      const restored = restore<TStepId>(storage, now());
      if (restored !== null) return restored;
    }
    return { collected: {}, activeStepId: initialStepId, updatedAt: now() };
    // Only seeded once on mount; subsequent renders preserve the
    // hydrated state. eslint-disable-next-line because the
    // dependencies array intentionally excludes `storage`/`now` so a
    // test that swaps them mid-render doesn't reset the wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [collected, setCollectedState] = useState<DeviceConfigInput>(initial.collected);
  const [activeStepId, setActiveStepIdState] = useState<TStepId>(initial.activeStepId);

  // Skip the persist effect on the very first render — `initial`
  // came either from storage or from the seed values, so writing
  // back immediately is a no-op that triggers a needless storage
  // round-trip in jsdom tests.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (bypassStorage) return;
    persist(storage, { collected, activeStepId, updatedAt: now() });
  }, [collected, activeStepId, storage, now, bypassStorage]);

  const setCollected = useCallback(
    (next: DeviceConfigInput | ((prev: DeviceConfigInput) => DeviceConfigInput)) => {
      setCollectedState((prev) => (typeof next === 'function' ? next(prev) : next));
    },
    [],
  );

  const setActiveStepId = useCallback((next: TStepId) => {
    setActiveStepIdState(next);
  }, []);

  const clear = useCallback(() => {
    try {
      storage.removeItem(WIZARD_SCRATCH_KEY);
    } catch {
      // ignore — storage may be unavailable (private mode etc.)
    }
  }, [storage]);

  return { collected, activeStepId, setCollected, setActiveStepId, clear };
}

/**
 * Standalone scratch-clear — for callers that need to drop the
 * wizard's persisted state without being inside the React tree
 * (e.g. the apply step's post-commit cleanup, which runs after
 * markComplete() and right before `window.location.reload()`).
 */
export function clearWizardScratch(storage: Storage = safeLocalStorageExport()): void {
  try {
    storage.removeItem(WIZARD_SCRATCH_KEY);
  } catch {
    // ignore — same fall-through as the hook's clear.
  }
}

function safeLocalStorageExport(): Storage {
  return safeLocalStorage();
}

function persist<TStepId extends string>(storage: Storage, entry: ScratchEntry<TStepId>): void {
  try {
    storage.setItem(WIZARD_SCRATCH_KEY, JSON.stringify(entry));
  } catch {
    // ignore — quota / unavailable storage. The wizard still works
    // in-memory; the user just doesn't get the post-refresh resume.
  }
}

function restore<TStepId extends string>(
  storage: Storage,
  nowMs: number,
): ScratchEntry<TStepId> | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(WIZARD_SCRATCH_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isScratchEntry(parsed)) return null;
  if (nowMs - parsed.updatedAt > TTL_MS) {
    // Stale — drop the entry so future restores don't bother.
    try {
      storage.removeItem(WIZARD_SCRATCH_KEY);
    } catch {
      // ignore.
    }
    return null;
  }
  return parsed as ScratchEntry<TStepId>;
}

function isScratchEntry(value: unknown): value is ScratchEntry<string> {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { collected?: unknown; activeStepId?: unknown; updatedAt?: unknown };
  return (
    candidate.collected !== undefined &&
    typeof candidate.collected === 'object' &&
    typeof candidate.activeStepId === 'string' &&
    typeof candidate.updatedAt === 'number'
  );
}

/**
 * Falls back to an in-memory `Map` when window.localStorage is not
 * available (SSR, sandboxed iframes, private mode in some browsers).
 * Tests inject their own storage explicitly, so this fallback only
 * fires in genuine runtime edge cases.
 */
function safeLocalStorage(): Storage {
  if (typeof window !== 'undefined') {
    return window.localStorage;
  }
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
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}
