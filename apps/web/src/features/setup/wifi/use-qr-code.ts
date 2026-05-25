// QR code generation hook. Wraps the `qrcode` library (~6 kB gz)
// into a single useEffect that resolves a data URL for the given
// value. The QR encoder runs entirely client-side via Web Crypto
// + Canvas; no network call.
//
// Returned `dataUrl` is `null` while generation is in flight or if
// generation fails (the modal copy explaining the URL is the
// fallback in that case — see `handoff-modal.tsx`).

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

interface UseQrCodeOptions {
  /** Target URL the QR should encode. Empty / undefined → no-op. */
  readonly value: string | undefined;
  /** Pixel size of the rendered QR (square). Defaults to 192. */
  readonly size?: number;
}

export function useQrCode({ value, size = 192 }: UseQrCodeOptions): {
  readonly dataUrl: string | null;
  readonly error: string | null;
} {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (value === undefined || value === '') {
      setDataUrl(null);
      setError(null);
      return;
    }
    void QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDataUrl(null);
        setError(err instanceof Error ? err.message : 'qr-generation-failed');
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return { dataUrl, error };
}
