// Pre-commit confirmation modal for the Wi-Fi handoff. Shown when
// the user clicks "Complete setup" on the review step and the
// device needs to switch from AP mode to the user's home network.
//
// Replaces the previous lightweight password-only PasswordDialog
// (#548) with a more deliberate ceremony:
//
//   - Re-confirms the password (typo guard kept from #548).
//   - Plain-language warning that the browser will lose its
//     connection to the device.
//   - QR code of the device's setup URL (`http://glaon.local` by
//     default) so the user can re-open the wizard from their phone
//     after they switch networks.
//   - Two buttons: "Wait — go back" and "Switch network now".
//
// The actual commit is owned by the parent (`apply-step.tsx` after
// #597; was `review-step.tsx` originally); this modal just calls
// `onConfirm(password)` and lets the parent dispatch the credential
// POST + transition to the switching state.

import { Button, Modal, PasswordInput } from '@glaon/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useQrCode } from './use-qr-code';

interface HandoffModalProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** SSID being joined — shown in the warning copy. */
  readonly ssid: string;
  /** True when the network is secured (password input visible). */
  readonly requiresPassword: boolean;
  /** Device URL the QR encodes — e.g. `http://glaon.local`. */
  readonly deviceUrl: string;
  /** Fires when the user clicks "Switch network now". Receives the
   *  password input value (empty string for open networks). */
  readonly onConfirm: (password: string) => void;
  /** When true, the confirm button shows a spinner; user cannot
   *  re-trigger the commit. */
  readonly isCommitting?: boolean;
}

export function HandoffModal({
  isOpen,
  onOpenChange,
  ssid,
  requiresPassword,
  deviceUrl,
  onConfirm,
  isCommitting = false,
}: HandoffModalProps): ReactNode {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const { dataUrl, error } = useQrCode({ value: deviceUrl, size: 176 });

  // Reset the password field whenever the modal closes — the next
  // open should never inherit a previous attempt.
  useEffect(() => {
    if (!isOpen) setPassword('');
  }, [isOpen]);

  const canConfirm = !isCommitting && (!requiresPassword || password.trim().length > 0);

  const onCancel = (): void => {
    if (isCommitting) return;
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Content size="lg">
        <Modal.Header>
          <Modal.Title>{t('setup.wifi.handoff.title', { ssid })}</Modal.Title>
          <Modal.Description>{t('setup.wifi.handoff.description', { ssid })}</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
            <div className="flex flex-col items-center gap-2">
              {dataUrl !== null ? (
                <img
                  src={dataUrl}
                  width={176}
                  height={176}
                  alt={t('setup.wifi.handoff.qrAlt', { url: deviceUrl })}
                  className="rounded-md ring-1 ring-secondary"
                />
              ) : (
                <div
                  className="flex h-44 w-44 items-center justify-center rounded-md bg-secondary text-tertiary"
                  role="img"
                  aria-label={t('setup.wifi.handoff.qrAlt', { url: deviceUrl })}
                >
                  {error !== null
                    ? t('setup.wifi.handoff.qrFallback')
                    : t('setup.wifi.handoff.qrLoading')}
                </div>
              )}
              <p className="break-all text-center text-xs text-tertiary">{deviceUrl}</p>
            </div>

            <div className="flex flex-1 flex-col gap-4">
              <ul className="flex flex-col gap-2 text-sm text-secondary">
                <li>{t('setup.wifi.handoff.bullet1', { ssid })}</li>
                <li>{t('setup.wifi.handoff.bullet2')}</li>
                <li>{t('setup.wifi.handoff.bullet3', { url: deviceUrl })}</li>
              </ul>

              {requiresPassword && (
                <div className="flex flex-col gap-1.5">
                  <PasswordInput
                    label={t('setup.wifi.handoff.passwordLabel', { ssid })}
                    value={password}
                    onChange={setPassword}
                    placeholder={t('setup.wifi.handoff.passwordPlaceholder')}
                    autoComplete="off"
                    isRequired
                  />
                  <p className="text-xs text-tertiary">{t('setup.wifi.handoff.passwordHint')}</p>
                </div>
              )}
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button size="md" color="secondary" onClick={onCancel} isDisabled={isCommitting}>
            {t('setup.wifi.handoff.cancel')}
          </Button>
          <Button
            size="md"
            color="primary"
            onClick={() => {
              onConfirm(password);
            }}
            isDisabled={!canConfirm}
            isLoading={isCommitting}
          >
            {t('setup.wifi.handoff.confirm')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}
