// Final Review wizard step — fifth and last step in the device setup
// wizard (epic #533, ADR 0028). Shows the user a summary of what they
// entered, then commits the blob and reloads.
//
// User flow (per #548 product decision — Figma frame ships later):
//
// 1. Render a read-only summary of every field the wizard collected.
//    Wi-Fi shows the SSID + auth tag but NOT the password — that
//    field is asked again in a modal at submit time so the user
//    always confirms the credential explicitly.
// 2. On "Complete setup":
//    a. If a secured Wi-Fi network was picked, open a modal asking
//       for the password. Connect / Cancel.
//    b. Otherwise commit straight away (open network or no Wi-Fi).
// 3. Commit ceremony:
//    a. If Wi-Fi: POST the selection + password to the HA Supervisor
//       network update endpoint. Toast danger on failure — stay on
//       review so the user can retry.
//    b. configStore.setPartial(<final blob>) + markComplete().
//    c. window.location.reload() — the gate sees the completed blob
//       on the next mount and drops the user on /login.
//
// Per the API Error Toast Rule (CLAUDE.md), commit failures surface
// through useToast; inline error blocks would mask the cross-step
// nature of the failure.

import { Button, Modal, PasswordInput, useToast } from '@glaon/ui';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput, Layout } from '@glaon/core/config';

import { useDeviceConfig } from '../../../config/config-provider';

interface ReviewStepProps {
  /** Final accumulated partial from prior steps. */
  readonly collected: DeviceConfigInput;
  /** Hint from the wizard route that this is the last step (unused in v1 — the step owns its CTA copy). */
  readonly onNext?: (partial: DeviceConfigInput) => void;
}

const SUPERVISOR_NETWORK_INTERFACE = 'wlan0';
const SUPERVISOR_NETWORK_UPDATE = `/api/hassio/network/${SUPERVISOR_NETWORK_INTERFACE}/update`;

function isSecuredCipher(cipher: string | undefined): boolean {
  return cipher !== undefined && cipher !== '' && cipher !== '(unsecured)';
}

interface PushWifiArgs {
  readonly ssid: string;
  readonly password: string;
  readonly secured: boolean;
}

async function pushWifiToSupervisor({ ssid, password, secured }: PushWifiArgs): Promise<void> {
  const body = secured
    ? { wifi: { mode: 'infrastructure', auth: 'wpa-psk', ssid, psk: password } }
    : { wifi: { mode: 'infrastructure', auth: 'open', ssid } };
  const response = await fetch(SUPERVISOR_NETWORK_UPDATE, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Supervisor responded ${String(response.status)}`);
  }
}

export function ReviewStep({ collected }: ReviewStepProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const { setPartial, markComplete } = useDeviceConfig();

  const wifi = collected.wifi;
  const isWifiSecured = wifi !== undefined && isSecuredCipher(wifi.passwordCipher);

  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState<boolean>(false);
  const [dialogPassword, setDialogPassword] = useState<string>('');
  const [isCommitting, setIsCommitting] = useState<boolean>(false);

  const onCompleteClick = (): void => {
    if (isWifiSecured) {
      setDialogPassword('');
      setIsPasswordDialogOpen(true);
      return;
    }
    void runCommit();
  };

  const onDialogConfirm = (): void => {
    if (dialogPassword.trim() === '') return;
    setIsPasswordDialogOpen(false);
    void runCommit(dialogPassword);
  };

  async function runCommit(secureWifiPassword?: string): Promise<void> {
    setIsCommitting(true);
    try {
      if (wifi !== undefined) {
        const secured = isSecuredCipher(wifi.passwordCipher);
        const password = secured ? (secureWifiPassword ?? '') : '';
        if (secured && password === '') {
          // Shouldn't reach here — the dialog gates this — but guard
          // so a future caller can't bypass.
          throw new Error('missing wifi password');
        }
        await pushWifiToSupervisor({ ssid: wifi.ssid, password, secured });
        // Update the collected wifi block with the cipher the user
        // confirmed in the dialog (overwrites whatever #546 stored).
        const persistedWifi = {
          ssid: wifi.ssid,
          passwordCipher: secured ? password : '(unsecured)',
        };
        await setPartial({ ...collected, wifi: persistedWifi });
      } else {
        await setPartial(collected);
      }
      await markComplete();
      window.location.reload();
    } catch {
      toast.show({
        intent: 'danger',
        title: t('setup.review.commitFailed.title'),
        description: t('setup.review.commitFailed.description'),
      });
    } finally {
      setIsCommitting(false);
    }
  }

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">{t('setup.review.title')}</h1>
        <p className="text-sm text-tertiary">{t('setup.review.subtitle')}</p>
      </header>

      <dl className="flex flex-col">
        <SummaryRow label={t('setup.homeOverview.homeName.label')} value={collected.homeName} />
        <SummaryRow label={t('setup.homeOverview.location.label')} value={collected.location} />
        <SummaryRow label={t('setup.homeOverview.country.label')} value={collected.country} />
        <SummaryRow label={t('setup.homeOverview.timezone.label')} value={collected.timezone} />
        <SummaryRow label={t('setup.homeOverview.language.label')} value={collected.locale} />
        <SummaryRow
          label={t('setup.homeOverview.unitSystem.label')}
          value={
            collected.unitSystem !== undefined
              ? t(`setup.homeOverview.unitSystem.${collected.unitSystem}.label`)
              : undefined
          }
        />
        <LayoutSummaryRow layout={collected.layout} />
        <SummaryRow
          label={t('setup.review.summary.wifi')}
          value={
            wifi !== undefined
              ? isSecuredCipher(wifi.passwordCipher)
                ? t('setup.review.summary.wifiSecured', { ssid: wifi.ssid })
                : t('setup.review.summary.wifiUnsecured', { ssid: wifi.ssid })
              : undefined
          }
        />
        <SummaryRow
          label={t('setup.review.summary.adminPassword')}
          value={
            collected.securityPinHash !== undefined
              ? t('setup.review.summary.passwordSet')
              : undefined
          }
        />
      </dl>

      <div className="flex justify-end gap-3 border-t border-secondary py-6">
        <Button size="md" color="primary" onClick={onCompleteClick} isLoading={isCommitting}>
          {t('setup.review.actions.complete')}
        </Button>
      </div>

      <Modal isOpen={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <Modal.Content size="md">
          <Modal.Header>
            <Modal.Title>
              {t('setup.review.passwordDialog.title', { ssid: wifi?.ssid ?? '' })}
            </Modal.Title>
            <Modal.Description>{t('setup.review.passwordDialog.description')}</Modal.Description>
          </Modal.Header>
          <Modal.Body>
            <PasswordInput
              value={dialogPassword}
              onChange={setDialogPassword}
              placeholder={t('setup.review.passwordDialog.placeholder')}
              autoComplete="off"
              isRequired
            />
          </Modal.Body>
          <Modal.Footer>
            <Button
              size="md"
              color="secondary"
              onClick={() => {
                setIsPasswordDialogOpen(false);
              }}
            >
              {t('setup.review.passwordDialog.cancel')}
            </Button>
            <Button
              size="md"
              color="primary"
              onClick={onDialogConfirm}
              isDisabled={dialogPassword.trim() === ''}
            >
              {t('setup.review.passwordDialog.connect')}
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal>
    </div>
  );
}

interface SummaryRowProps {
  readonly label: string;
  readonly value: string | undefined;
}

function SummaryRow({ label, value }: SummaryRowProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-secondary py-4 sm:grid-cols-[240px_1fr] sm:items-baseline sm:gap-8">
      <dt className="text-sm font-semibold text-secondary">{label}</dt>
      <dd className="text-sm text-tertiary">
        {value !== undefined && value !== '' ? value : t('setup.review.summary.notSet')}
      </dd>
    </div>
  );
}

interface LayoutSummaryRowProps {
  readonly layout: Layout | undefined;
}

function LayoutSummaryRow({ layout }: LayoutSummaryRowProps): ReactNode {
  const { t } = useTranslation();
  const label = t('setup.layoutSetup.label');

  if (layout === undefined || layout.floors.length === 0) {
    return <SummaryRow label={label} value={undefined} />;
  }

  const totalRooms = layout.floors.reduce((sum, floor) => sum + floor.rooms.length, 0);
  const headline = t('setup.review.summary.layoutHeadline', {
    floorCount: layout.floors.length,
    roomCount: totalRooms,
  });

  return (
    <div className="grid grid-cols-1 gap-2 border-t border-secondary py-4 sm:grid-cols-[240px_1fr] sm:items-baseline sm:gap-8">
      <dt className="text-sm font-semibold text-secondary">{label}</dt>
      <dd className="flex flex-col gap-1 text-sm text-tertiary">
        <span className="font-medium text-primary">{headline}</span>
        <ul className="flex flex-col gap-1">
          {layout.floors.map((floor) => {
            const roomNames = floor.rooms.map((r) => r.name).join(', ');
            return (
              <li key={floor.id} className="truncate">
                <span className="font-medium text-secondary">{floor.name}</span>
                {floor.rooms.length > 0 ? (
                  <>
                    <span aria-hidden="true"> — </span>
                    <span>{roomNames}</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true"> — </span>
                    <span className="italic">{t('setup.review.summary.layoutEmptyFloor')}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </dd>
    </div>
  );
}
