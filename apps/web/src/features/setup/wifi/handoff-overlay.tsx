// Full-screen overlay shown after the user confirms the handoff —
// while the device is committing the new Wi-Fi credentials and the
// browser is about to lose its AP connection.
//
// In v1 there is no persistence (deferred to #595), so the overlay
// stays visible until the browser literally loses the connection
// and the page is closed. After the user manually switches their
// phone / laptop to the home network and reopens the setup URL,
// the wizard restarts from step 1 (acceptable v1 limitation).
//
// The overlay is identity-friendly: same QR code as the modal so
// the user can scan it again if they didn't earlier; explicit URL
// they can type if scan fails; a "still here?" nudge that surfaces
// after 30 seconds suggesting the user switch networks themselves.

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SpinnerIcon } from './wifi-icons';
import { useQrCode } from './use-qr-code';

interface HandoffOverlayProps {
  readonly ssid: string;
  readonly deviceUrl: string;
}

const NUDGE_DELAY_MS = 30_000;

export function HandoffOverlay({ ssid, deviceUrl }: HandoffOverlayProps): ReactNode {
  const { t } = useTranslation();
  const { dataUrl } = useQrCode({ value: deviceUrl, size: 224 });
  const [showNudge, setShowNudge] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => {
      setShowNudge(true);
    }, NUDGE_DELAY_MS);
    return () => {
      clearTimeout(handle);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/95 px-6 py-10 backdrop-blur-sm"
    >
      <div className="flex max-w-xl flex-col items-center gap-6 rounded-2xl bg-primary p-8 text-center ring-1 ring-secondary">
        <div className="flex items-center gap-3 text-brand-primary">
          <SpinnerIcon className="size-6" />
          <h2 className="text-xl font-semibold text-primary">
            {t('setup.wifi.handoff.overlay.title', { ssid })}
          </h2>
        </div>

        <p className="text-sm text-secondary">
          {t('setup.wifi.handoff.overlay.description', { ssid })}
        </p>

        {dataUrl !== null && (
          <img
            src={dataUrl}
            width={224}
            height={224}
            alt={t('setup.wifi.handoff.qrAlt', { url: deviceUrl })}
            className="rounded-md ring-1 ring-secondary"
          />
        )}

        <p className="break-all text-sm font-medium text-primary">{deviceUrl}</p>

        {showNudge && (
          <p className="rounded-lg bg-secondary px-4 py-3 text-xs text-secondary">
            {t('setup.wifi.handoff.overlay.nudge', { ssid, url: deviceUrl })}
          </p>
        )}
      </div>
    </div>
  );
}
