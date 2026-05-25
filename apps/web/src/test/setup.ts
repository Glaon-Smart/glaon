import '@testing-library/jest-dom/vitest';

import { webcrypto } from 'node:crypto';
import { cleanup } from '@testing-library/react';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';
import { afterEach } from 'vitest';

// jsdom's `crypto.subtle` is a partial shim — `generateKey` returns
// objects but `encrypt`/`decrypt` consistently fail with "Cipher
// job failed". Swap in Node's webcrypto so anything that touches
// `crypto.subtle` (wifi-crypto.ts, QR code lib, etc.) sees a
// functional implementation. The two APIs are interchangeable —
// Node implements the same WebCrypto spec.
//
// Force the override unconditionally; the `crypto.subtle === undefined`
// guard isn't enough because jsdom defines a (broken) `subtle` so the
// check would short-circuit and we'd ship the broken shim into every
// AES test.
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
});
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}

import en from '../i18n/locales/en.json';
import tr from '../i18n/locales/tr.json';

// Initialize the global i18next instance for tests so components that
// call `useTranslation()` resolve real strings (and probe.toHaveTextContent
// regexes still match on the EN copy). Production wires its own scoped
// instance via `<I18nProvider>` in main.tsx — this default is jsdom-only.
if (!i18next.isInitialized) {
  void i18next
    .use(ICU)
    .use(initReactI18next)
    .init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { translation: en },
        tr: { translation: tr },
      },
      interpolation: { escapeValue: false },
      returnNull: false,
    });
}

afterEach(() => {
  cleanup();
});
