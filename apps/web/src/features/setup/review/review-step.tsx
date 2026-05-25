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

import { Button, useToast } from '@glaon/ui';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput, Layout } from '@glaon/core/config';

import { useDeviceConfig } from '../../../config/config-provider';
import { HandoffModal } from '../wifi/handoff-modal';
import { HandoffOverlay } from '../wifi/handoff-overlay';

interface ReviewStepProps {
  /** Final accumulated partial from prior steps. */
  readonly collected: DeviceConfigInput;
  /** Hint from the wizard route that this is the last step (unused in v1 — the step owns its CTA copy). */
  readonly onNext?: (partial: DeviceConfigInput) => void;
}

const SUPERVISOR_NETWORK_INTERFACE = 'wlan0';
const SUPERVISOR_NETWORK_UPDATE = `/api/hassio/network/${SUPERVISOR_NETWORK_INTERFACE}/update`;

// Hard-coded URL the QR code encodes. mDNS responder advertises the
// device under `glaon.local` on the home network (addon-side concern).
// Per-device hostnames (`glaon-<serial>.local`) are tracked as a
// follow-up — see #594 open questions.
const DEVICE_URL_AFTER_HANDOFF = 'http://glaon.local';

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

  // Commit-ceremony phases for the production-grade Wi-Fi handoff
  // (#594). Phase transitions:
  //
  //   idle       → user hasn't clicked "Complete setup" yet.
  //   confirming → HandoffModal open (or, for open networks / no-wifi,
  //                briefly held while runCommit fires; the modal is
  //                skipped because there is no password to re-enter
  //                and no AP→home handoff to warn about).
  //   committing → POST in flight to the supervisor's network-update
  //                endpoint. Modal stays open with its confirm button
  //                in spinner state so the user can't double-click.
  //   switching  → POST returned OK; the HandoffOverlay takes over
  //                full-screen until the browser literally loses the
  //                connection (no persistence yet — see #595).
  type HandoffPhase = 'idle' | 'confirming' | 'committing' | 'switching';
  const [handoffPhase, setHandoffPhase] = useState<HandoffPhase>('idle');

  const onCompleteClick = (): void => {
    if (isWifiSecured) {
      setHandoffPhase('confirming');
      return;
    }
    // Open / no-wifi networks skip the modal — there's no password
    // to re-confirm and (for the no-wifi case) no network handoff
    // happens. The overlay still surfaces so the user gets the
    // "reload your device" cue for the rare open-AP case.
    void runCommit('');
  };

  const onHandoffConfirm = (password: string): void => {
    if (isWifiSecured && password.trim() === '') return;
    void runCommit(password);
  };

  async function runCommit(secureWifiPassword: string): Promise<void> {
    setHandoffPhase('committing');
    try {
      if (wifi !== undefined) {
        const secured = isSecuredCipher(wifi.passwordCipher);
        const password = secured ? secureWifiPassword : '';
        if (secured && password === '') {
          throw new Error('missing wifi password');
        }
        await pushWifiToSupervisor({ ssid: wifi.ssid, password, secured });
        const persistedWifi = {
          ssid: wifi.ssid,
          passwordCipher: secured ? password : '(unsecured)',
        };
        await setPartial({ ...collected, wifi: persistedWifi });
      } else {
        await setPartial(collected);
      }
      await markComplete();
      // If a wifi handoff is in flight, transition to the overlay so
      // the user gets the "switch your phone to {ssid}, reopen
      // glaon.local" affordance. The reload races with the actual
      // device-side AP drop; whichever wins is fine — the overlay is
      // the same content the user would see if the reload landed
      // first.
      if (wifi !== undefined && isWifiSecured) {
        setHandoffPhase('switching');
        // Defer the reload by a moment so the user catches a beat of
        // the overlay; in practice the addon drops the AP first.
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        window.location.reload();
      }
    } catch {
      // On failure: secured-wifi case re-opens the modal so the
      // user can retry / re-enter the password; unsecured (or
      // no-wifi) case returns to idle since there's no modal to
      // re-open. Toast fires in both flavours.
      setHandoffPhase(isWifiSecured ? 'confirming' : 'idle');
      toast.show({
        intent: 'danger',
        title: t('setup.review.commitFailed.title'),
        description: t('setup.review.commitFailed.description'),
      });
    }
  }

  const isCommitting = handoffPhase === 'committing';

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

      <HandoffModal
        isOpen={handoffPhase === 'confirming' || handoffPhase === 'committing'}
        onOpenChange={(open) => {
          if (!open) setHandoffPhase('idle');
        }}
        ssid={wifi?.ssid ?? ''}
        requiresPassword={isWifiSecured}
        deviceUrl={DEVICE_URL_AFTER_HANDOFF}
        onConfirm={onHandoffConfirm}
        isCommitting={isCommitting}
      />

      {handoffPhase === 'switching' && (
        <HandoffOverlay ssid={wifi?.ssid ?? ''} deviceUrl={DEVICE_URL_AFTER_HANDOFF} />
      )}
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
