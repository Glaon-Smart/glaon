// AES-GCM password wrap for the Wi-Fi commit (#595).
//
// `DeviceConfigSchema.wifi.passwordCipher` is declared as a
// non-empty string opaque to `@glaon/core` (ADR 0028). Before this
// helper landed, the wizard stored the user's plaintext Wi-Fi
// password verbatim in that field — fine while the value lived in
// route-local `useState` for the duration of a wizard session, but
// after #595 the same blob is **persisted to localStorage** via
// `useWizardState`, which would violate the Security-First Rule
// "No plaintext credentials".
//
// The wrap uses AES-GCM with a per-device key derived once per
// installation and held in `localStorage` under
// `glaon.wizard.wrap-key`. The cipher format is
// `AES-GCM:<base64url(iv|ciphertext|tag)>` — the `AES-GCM:` prefix
// is what `DeviceConfigSchema` already implicitly expects (the kit
// has been storing strings of that shape since #546).
//
// Key lifecycle:
//
//   - Generated the first time the wizard needs a wrap, persisted
//     as a base64 JWK.
//   - Reused across wizard runs while the device is in the same
//     browser session.
//   - Cleared by the apply step right after `markComplete()`
//     fires — once setup is done the key is no longer needed.
//
// XSS trade-off: the key sits in `localStorage` so a sufficiently
// privileged script on the same origin could read it. We accept
// this for pre-completion wizard work because (a) the wizard runs
// before any login exists, so the XSS surface is the wizard's own
// chunk — no third-party widgets, no user-generated content; (b)
// the key's lifetime is bounded by the wizard run (cleared on
// completion); (c) CSP already locks down `script-src` to `'self'`.
// For long-lived credential storage (e.g. cloud-mode session) we
// would need hardware-backed storage or a server-side wrap.

const WRAP_PREFIX = 'AES-GCM:';
const WRAP_KEY_STORAGE_KEY = 'glaon.wizard.wrap-key';
const IV_LENGTH = 12;
const AES_KEY_BITS = 256;

interface WifiCryptoOptions {
  /** Override storage in tests. Defaults to `window.localStorage`. */
  readonly storage?: Storage;
  /** Override `crypto.subtle` in tests / SSR. */
  readonly subtle?: SubtleCrypto;
  /** Override `crypto.getRandomValues` in tests. */
  readonly getRandomValues?: typeof crypto.getRandomValues;
}

/**
 * Wrap a plaintext password into the `AES-GCM:<base64url>` cipher
 * shape. Idempotent on already-wrapped values: passing in a
 * cipher returns it unchanged. Empty / unsecured sentinels
 * (`'(unsecured)'`) flow through verbatim because they aren't
 * credentials.
 */
export async function wrapPassword(
  plaintext: string,
  opts: WifiCryptoOptions = {},
): Promise<string> {
  if (plaintext === '' || plaintext === '(unsecured)') return plaintext;
  if (isWrapped(plaintext)) return plaintext;
  const subtle = resolveSubtle(opts.subtle);
  const key = await getOrCreateDeviceKey(opts);
  const iv = randomIv(opts.getRandomValues);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const envelope = new Uint8Array(iv.length + ciphertext.length);
  envelope.set(iv, 0);
  envelope.set(ciphertext, iv.length);
  return `${WRAP_PREFIX}${toBase64Url(envelope)}`;
}

/**
 * Reverse of `wrapPassword`. Throws on a malformed envelope or a
 * key mismatch. Unwrapped strings (or the unsecured sentinel) pass
 * through verbatim — handy when consumers don't know up front
 * whether the value was wrapped.
 */
export async function unwrapPassword(
  cipher: string,
  opts: WifiCryptoOptions = {},
): Promise<string> {
  if (cipher === '' || cipher === '(unsecured)') return cipher;
  if (!isWrapped(cipher)) return cipher;
  const subtle = resolveSubtle(opts.subtle);
  const key = await getOrCreateDeviceKey(opts);
  const envelope = fromBase64Url(cipher.slice(WRAP_PREFIX.length));
  if (envelope.length <= IV_LENGTH) throw new Error('wifi-crypto: envelope too short');
  const iv = envelope.slice(0, IV_LENGTH);
  const ciphertext = envelope.slice(IV_LENGTH);
  const plaintextBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintextBuf);
}

/** True when `value` carries the wrap prefix. */
export function isWrapped(value: string): boolean {
  return value.startsWith(WRAP_PREFIX);
}

/**
 * Drop the persisted device key. Call from the apply step's
 * post-commit cleanup so a completed wizard doesn't leave the
 * wrap key sitting in localStorage.
 */
export function clearDeviceKey(storage: Storage = resolveStorage()): void {
  try {
    storage.removeItem(WRAP_KEY_STORAGE_KEY);
  } catch {
    // Ignore — same fallthrough as the persistence hook.
  }
}

// =============================================================
// Internals
// =============================================================

async function getOrCreateDeviceKey(opts: WifiCryptoOptions): Promise<CryptoKey> {
  const subtle = resolveSubtle(opts.subtle);
  const storage = opts.storage ?? resolveStorage();
  const existing = readKeyJwk(storage);
  if (existing !== null) {
    try {
      return await subtle.importKey('jwk', existing, { name: 'AES-GCM' }, true, [
        'encrypt',
        'decrypt',
      ]);
    } catch {
      // Corrupt / mismatched key — fall through to regenerate.
    }
  }
  const key = await subtle.generateKey({ name: 'AES-GCM', length: AES_KEY_BITS }, true, [
    'encrypt',
    'decrypt',
  ]);
  const jwk = await subtle.exportKey('jwk', key);
  writeKeyJwk(storage, jwk);
  return key;
}

function readKeyJwk(storage: Storage): JsonWebKey | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(WRAP_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as JsonWebKey;
    if (typeof parsed.kty !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeKeyJwk(storage: Storage, jwk: JsonWebKey): void {
  try {
    storage.setItem(WRAP_KEY_STORAGE_KEY, JSON.stringify(jwk));
  } catch {
    // ignore — wizard still works, but the key won't survive a refresh.
  }
}

function randomIv(getRandomValues: typeof crypto.getRandomValues | undefined): Uint8Array {
  const iv = new Uint8Array(IV_LENGTH);
  const impl = getRandomValues ?? crypto.getRandomValues.bind(crypto);
  impl(iv);
  return iv;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary =
    typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function resolveSubtle(injected: SubtleCrypto | undefined): SubtleCrypto {
  if (injected !== undefined) return injected;
  // `crypto` is typed as a non-nullable global by `lib.dom.d.ts`, so
  // a `typeof crypto !== 'undefined'` guard would be dead code. Trust
  // the typings; a missing global would surface as a ReferenceError
  // which the caller can catch.
  return crypto.subtle;
}

function resolveStorage(): Storage {
  if (typeof window !== 'undefined') {
    return window.localStorage;
  }
  // Same in-memory fallback shape as `use-wizard-state.safeLocalStorage`.
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
