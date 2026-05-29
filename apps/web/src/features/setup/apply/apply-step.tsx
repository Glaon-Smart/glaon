// Apply — terminal wizard step (#597, #629). A read-only review of
// everything collected in steps 1–4, then the single commit ceremony:
//
//   1. Push the home settings into HA Core (#617).
//   2. Push the device hostname + per-interface IPv4/IPv6 to the
//      Supervisor (collected in the Network step, #629).
//   3. Join the home Wi-Fi network — the destructive handoff: HandoffModal
//      confirms, HandoffOverlay takes over while the device drops its AP
//      and joins the home network, then the page reloads to /login.
//
// Wi-Fi credentials + network config are collected earlier (Network step,
// #629) and arrive here via `collected`; this step no longer scans or
// prompts for them — it reads them and commits. The handoff stays
// terminal because the network switch is still the user's commitment
// moment (#597 rationale preserved).
//
// Per the API Error Toast Rule (CLAUDE.md), commit failures surface
// through useToast; inline error blocks would mask the cross-section
// nature of the failure.

import { Button, useToast } from '@glaon/ui';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApplyHaResponse } from '@glaon/core/api-client';
import type { DeviceConfigInput, Layout } from '@glaon/core/config';

import { useDeviceConfig } from '../../../config/config-provider';
import { clearWizardScratch } from '../../../setup/use-wizard-state';
import {
  DEFAULT_WIRELESS_INTERFACE,
  NETWORK_INFO_URL,
  findWirelessInterface,
  pushHostname,
  pushInterfaceUpdate,
  toSupervisorIpBlock,
} from '../network/network-api';
import { HandoffModal } from '../wifi/handoff-modal';
import { HandoffOverlay } from '../wifi/handoff-overlay';
import { clearDeviceKey, unwrapPassword } from '../wifi/wifi-crypto';

interface ApplyStepProps {
  /** Final accumulated partial from prior steps. */
  readonly collected: DeviceConfigInput;
  /** Hint from the wizard route that this is the last step (unused — the apply step owns its CTA copy). */
  readonly onNext?: (partial: DeviceConfigInput) => void;
}

// #617 — apps/api endpoint that pushes the collected home settings into
// HA Core (config/core/update + floor/area registry) over WebSocket.
const HA_APPLY_SETTINGS = '/api/setup/apply-ha';

// Hard-coded URL the QR code encodes. The mDNS responder advertises the
// device under `glaon.local` on the home network (addon-side concern).
const DEVICE_URL_AFTER_HANDOFF = 'http://glaon.local';

function isSecuredCipher(cipher: string | undefined): boolean {
  return cipher !== undefined && cipher !== '' && cipher !== '(unsecured)';
}

/**
 * Outcome of pushing the collected home settings into HA Core (#617).
 *   - `ok`       every command landed.
 *   - `skipped`  apps/api has no HA Core configured (503) — expected in
 *                dev when HA_CORE_* is unset; not a user-facing error.
 *   - `partial`  some commands failed (HA reachable, rejected a step).
 *   - `error`    couldn't reach apps/api / HA, or a malformed response.
 */
type HaApplyOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'partial' }
  | { readonly kind: 'error' };

async function pushSettingsToHa(collected: DeviceConfigInput): Promise<HaApplyOutcome> {
  const body: Record<string, unknown> = {};
  if (collected.latitude !== undefined) body.latitude = collected.latitude;
  if (collected.longitude !== undefined) body.longitude = collected.longitude;
  if (collected.unitSystem !== undefined) body.unitSystem = collected.unitSystem;
  if (collected.timezone !== undefined) body.timezone = collected.timezone;
  if (collected.country !== undefined) body.country = collected.country;
  if (collected.locale !== undefined) body.locale = collected.locale;
  if (collected.layout !== undefined) body.layout = collected.layout;

  // Nothing collected that maps to HA → no-op success.
  if (Object.keys(body).length === 0) return { kind: 'ok' };

  let response: Response;
  try {
    response = await fetch(HA_APPLY_SETTINGS, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'error' };
  }
  if (response.status === 503) return { kind: 'skipped' };
  if (!response.ok) return { kind: 'error' };
  const json = (await response.json().catch(() => null)) as ApplyHaResponse | null;
  if (json === null) return { kind: 'error' };
  return json.ok ? { kind: 'ok' } : { kind: 'partial' };
}

/** Discover the wireless interface so the Wi-Fi handoff targets the right
 * one. Best-effort: defaults to wlan0 if /network/info can't be reached. */
async function discoverWirelessInterface(): Promise<string> {
  try {
    const response = await fetch(NETWORK_INFO_URL, { credentials: 'include' });
    if (response.ok) return findWirelessInterface(await response.json().catch(() => null));
  } catch {
    // fall through to the default
  }
  return DEFAULT_WIRELESS_INTERFACE;
}

type HandoffPhase = 'idle' | 'confirming' | 'committing' | 'switching';

export function ApplyStep({ collected }: ApplyStepProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const { setPartial, markComplete } = useDeviceConfig();

  const [handoffPhase, setHandoffPhase] = useState<HandoffPhase>('idle');
  const isCommitting = handoffPhase === 'committing';

  const wifi = collected.wifi;
  const wifiSecured = wifi !== undefined && isSecuredCipher(wifi.passwordCipher);

  const wifiSummaryValue =
    wifi !== undefined
      ? wifiSecured
        ? t('setup.apply.summary.wifiSecured', { ssid: wifi.ssid })
        : t('setup.apply.summary.wifiUnsecured', { ssid: wifi.ssid })
      : undefined;

  const onApplyClick = (): void => {
    if (isCommitting) return;
    // A secured network routes through the confirmation modal (the
    // disconnect warning); open / no-Wi-Fi commits go straight through.
    if (wifiSecured) {
      setHandoffPhase('confirming');
      return;
    }
    void runCommit('');
  };

  const onHandoffConfirm = (): void => {
    void confirmAndCommit();
  };

  async function confirmAndCommit(): Promise<void> {
    // The plaintext PSK for the Supervisor comes from unwrapping the
    // cipher the Network step persisted (#629) — the user doesn't re-type
    // it. A failed unwrap (missing/rotated device key) aborts cleanly.
    let plaintext = '';
    if (wifi !== undefined) {
      try {
        plaintext = await unwrapPassword(wifi.passwordCipher);
      } catch {
        setHandoffPhase('idle');
        toast.show({
          intent: 'danger',
          title: t('setup.apply.commitFailed.title'),
          description: t('setup.apply.commitFailed.description'),
        });
        return;
      }
    }
    void runCommit(plaintext);
  }

  async function runCommit(wifiPassword: string): Promise<void> {
    setHandoffPhase('committing');

    // Push home settings to HA *before* touching the network — non-
    // destructive, network still stable, so a failure aborts cleanly. A
    // `skipped` outcome (no HA Core configured — dev 503) proceeds.
    const haOutcome = await pushSettingsToHa(collected);
    if (haOutcome.kind === 'error' || haOutcome.kind === 'partial') {
      setHandoffPhase(wifiSecured ? 'confirming' : 'idle');
      toast.show({
        intent: 'danger',
        title: t('setup.apply.haSettingsFailed.title'),
        description: t('setup.apply.haSettingsFailed.description'),
      });
      return;
    }

    try {
      // Hostname first — cheap and non-destructive.
      if (collected.network?.hostname !== undefined) {
        await pushHostname(collected.network.hostname);
      }

      // Per-interface IP config. The wireless interface's update folds in
      // the Wi-Fi credentials so the home-network join is one request.
      const wirelessIface = wifi !== undefined ? await discoverWirelessInterface() : undefined;
      const interfaces = collected.network?.interfaces ?? [];
      const wifiBody = wifiSecured
        ? { mode: 'infrastructure', auth: 'wpa-psk', ssid: wifi.ssid, psk: wifiPassword }
        : { mode: 'infrastructure', auth: 'open', ssid: wifi?.ssid };

      for (const iface of interfaces) {
        const body: Record<string, unknown> = {};
        if (iface.ipv4 !== undefined) body.ipv4 = toSupervisorIpBlock(iface.ipv4);
        if (iface.ipv6 !== undefined) body.ipv6 = toSupervisorIpBlock(iface.ipv6);
        if (iface.name === wirelessIface && wifi !== undefined) body.wifi = wifiBody;
        if (Object.keys(body).length > 0) await pushInterfaceUpdate(iface.name, body);
      }

      // Edge: Wi-Fi was chosen but the Network step never collected an
      // interface list (it degraded to "unavailable") — push Wi-Fi on its
      // own to the discovered wireless interface.
      const wirelessInList = interfaces.some((i) => i.name === wirelessIface);
      if (wifi !== undefined && !wirelessInList) {
        await pushInterfaceUpdate(wirelessIface ?? DEFAULT_WIRELESS_INTERFACE, { wifi: wifiBody });
      }

      await setPartial(collected);
      await markComplete();
      // Wizard complete — drop the scratch entry + wrap key so a future
      // visit never resurrects this run's state.
      clearWizardScratch();
      clearDeviceKey();

      // Secured commits route through the handoff overlay — the AP→home
      // disconnect moment. Open / no-Wi-Fi commits reload straight away.
      if (wifiSecured) {
        setHandoffPhase('switching');
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        window.location.reload();
      }
    } catch {
      setHandoffPhase(wifiSecured ? 'confirming' : 'idle');
      toast.show({
        intent: 'danger',
        title: t('setup.apply.commitFailed.title'),
        description: t('setup.apply.commitFailed.description'),
      });
    }
  }

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">{t('setup.apply.title')}</h1>
        <p className="text-sm text-tertiary">{t('setup.apply.subtitle')}</p>
      </header>

      <section aria-labelledby="apply-summary-heading" className="flex flex-col">
        <h2
          id="apply-summary-heading"
          className="pb-2 text-sm font-semibold uppercase tracking-wide text-tertiary"
        >
          {t('setup.apply.summary.heading')}
        </h2>
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
            label={t('setup.network.hostname.label')}
            value={collected.network?.hostname}
          />
          <SummaryRow label={t('setup.apply.summary.wifi')} value={wifiSummaryValue} />
          <SummaryRow
            label={t('setup.apply.summary.adminPassword')}
            value={
              collected.securityPinHash !== undefined
                ? t('setup.apply.summary.passwordSet')
                : undefined
            }
          />
        </dl>
      </section>

      <div className="mt-4 flex justify-end gap-3 border-t border-secondary py-6">
        <Button
          size="md"
          color="primary"
          onClick={onApplyClick}
          isLoading={isCommitting}
          isDisabled={isCommitting}
        >
          {t('setup.apply.actions.save')}
        </Button>
      </div>

      <HandoffModal
        isOpen={handoffPhase === 'confirming' || handoffPhase === 'committing'}
        onOpenChange={(open) => {
          if (!open) setHandoffPhase('idle');
        }}
        ssid={wifi?.ssid ?? ''}
        requiresPassword={false}
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

// =============================================================
// Summary rows
// =============================================================

interface SummaryRowProps {
  readonly label: string;
  readonly value: string | undefined;
}

function SummaryRow({ label, value }: SummaryRowProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-secondary py-3 sm:grid-cols-[240px_1fr] sm:items-baseline sm:gap-8">
      <dt className="text-sm font-semibold text-secondary">{label}</dt>
      <dd className="text-sm text-tertiary">
        {value !== undefined && value !== '' ? value : t('setup.apply.summary.notSet')}
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
  const headline = t('setup.apply.summary.layoutHeadline', {
    floorCount: layout.floors.length,
    roomCount: totalRooms,
  });

  return (
    <div className="grid grid-cols-1 gap-2 border-t border-secondary py-3 sm:grid-cols-[240px_1fr] sm:items-baseline sm:gap-8">
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
                    <span className="italic">{t('setup.apply.summary.layoutEmptyFloor')}</span>
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
