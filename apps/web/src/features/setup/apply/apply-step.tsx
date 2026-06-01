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

import type { DeviceConfigInput, InterfaceConfig, IpConfig, Layout } from '@glaon/core/config';

import { useDeviceConfig } from '../../../config/config-provider';
import {
  DEFAULT_WIRELESS_INTERFACE,
  NETWORK_INFO_URL,
  findWirelessInterface,
  pushInterfaceUpdate,
} from '../network/network-api';
import { HandoffModal } from '../wifi/handoff-modal';
import { HandoffOverlay } from '../wifi/handoff-overlay';
import { clearDeviceKey, unwrapPassword } from '../wifi/wifi-crypto';
import { WizardBackButton } from '../wizard-back-button';

interface ApplyStepProps {
  /** Final accumulated partial from prior steps. */
  readonly collected: DeviceConfigInput;
  /** Hint from the wizard route that this is the last step (unused — the apply step owns its CTA copy). */
  readonly onNext?: (partial: DeviceConfigInput) => void;
  /** Go back to the Network step (#637). Undefined would hide Back, but apply is never first. */
  readonly onBack?: () => void;
}

// Hard-coded URL the QR code encodes. The mDNS responder advertises the
// device under `glaon.local` on the home network (addon-side concern).
const DEVICE_URL_AFTER_HANDOFF = 'http://glaon.local';

function isSecuredCipher(cipher: string | undefined): boolean {
  return cipher !== undefined && cipher !== '' && cipher !== '(unsecured)';
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

export function ApplyStep({ collected, onBack }: ApplyStepProps): ReactNode {
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

    try {
      // Everything non-destructive is already on the device via per-step
      // saves: HA settings (#646), layout (#652), hostname + IP config
      // (#653), and the security config. All that's left here is the
      // destructive Wi-Fi join — push the credentials to the wireless
      // interface, which is the AP→home disconnect moment.
      if (wifi !== undefined) {
        const wirelessIface = await discoverWirelessInterface();
        const wifiBody = wifiSecured
          ? { mode: 'infrastructure', auth: 'wpa-psk', ssid: wifi.ssid, psk: wifiPassword }
          : { mode: 'infrastructure', auth: 'open', ssid: wifi.ssid };
        await pushInterfaceUpdate(wirelessIface, { wifi: wifiBody });
      }

      // Mirror the full collected blob into the ConfigStore + mark the
      // wizard complete. (Most fields were already persisted per-step; this
      // is the authoritative final write + the `completedAt` flip.)
      await setPartial(collected);
      await markComplete();
      // Wizard complete — drop the Wi-Fi wrap key so a future visit never
      // resurrects this run's credential. (Wizard state is in-memory only
      // since #646, so there is no localStorage scratch to clear.)
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

      <div className="flex flex-col gap-4">
        <ReviewCard icon={<HomeGlyph />} title={t('setup.homeOverview.title')}>
          <ReviewRow label={t('setup.homeOverview.homeName.label')} value={collected.homeName} />
          <ReviewRow label={t('setup.homeOverview.location.label')} value={collected.location} />
          <ReviewRow label={t('setup.homeOverview.country.label')} value={collected.country} />
          <ReviewRow label={t('setup.homeOverview.timezone.label')} value={collected.timezone} />
          <ReviewRow label={t('setup.homeOverview.language.label')} value={collected.locale} />
          <ReviewRow
            label={t('setup.homeOverview.unitSystem.label')}
            value={
              collected.unitSystem !== undefined
                ? t(`setup.homeOverview.unitSystem.${collected.unitSystem}.label`)
                : undefined
            }
          />
        </ReviewCard>

        <ReviewCard icon={<LayoutGlyph />} title={t('setup.layoutSetup.label')}>
          <LayoutCardBody layout={collected.layout} />
        </ReviewCard>

        <ReviewCard icon={<NetworkGlyph />} title={t('setup.network.title')}>
          <ReviewRow
            label={t('setup.network.hostname.label')}
            value={collected.network?.hostname}
          />
          <InterfacesReview interfaces={collected.network?.interfaces} />
          <ReviewRow label={t('setup.apply.summary.wifi')} value={wifiSummaryValue} />
        </ReviewCard>

        <ReviewCard icon={<SecurityGlyph />} title={t('setup.security.title')}>
          <ReviewRow label={t('setup.security.username.label')} value={collected.adminUsername} />
          <ReviewRow
            label={t('setup.apply.summary.adminPassword')}
            value={
              collected.securityPinHash !== undefined
                ? t('setup.apply.summary.passwordSet')
                : undefined
            }
          />
        </ReviewCard>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-secondary py-6">
        {onBack !== undefined ? <WizardBackButton onBack={onBack} /> : <span />}
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
// Review cards (#630) — grouped, scannable summary. Feature-local
// (like the Network step's own sub-components); not a @glaon/ui
// primitive until a second consumer arrives.
// =============================================================

interface ReviewCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly children: ReactNode;
}

function ReviewCard({ icon, title, children }: ReviewCardProps): ReactNode {
  return (
    <section className="rounded-xl border border-secondary bg-primary p-5">
      <div className="flex items-center gap-3 pb-1">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-secondary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset"
        >
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
      </div>
      <dl className="flex flex-col">{children}</dl>
    </section>
  );
}

interface ReviewRowProps {
  readonly label: string;
  readonly value: string | undefined;
}

function ReviewRow({ label, value }: ReviewRowProps): ReactNode {
  const { t } = useTranslation();
  const isSet = value !== undefined && value !== '';
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-secondary py-2.5">
      <dt className="text-sm font-medium text-secondary">{label}</dt>
      <dd className={`text-right text-sm ${isSet ? 'text-tertiary' : 'text-quaternary'}`}>
        {isSet ? value : t('setup.apply.summary.notSet')}
      </dd>
    </div>
  );
}

function LayoutCardBody({ layout }: { readonly layout: Layout | undefined }): ReactNode {
  const { t } = useTranslation();

  if (layout === undefined || layout.floors.length === 0) {
    return <ReviewRow label={t('setup.layoutSetup.label')} value={undefined} />;
  }

  const totalRooms = layout.floors.reduce((sum, floor) => sum + floor.rooms.length, 0);
  const headline = t('setup.apply.summary.layoutHeadline', {
    floorCount: layout.floors.length,
    roomCount: totalRooms,
  });

  return (
    <div className="flex flex-col gap-1 border-t border-secondary py-2.5 text-sm text-tertiary">
      <span className="font-medium text-primary">{headline}</span>
      <ul className="flex flex-col gap-1">
        {layout.floors.map((floor) => {
          const roomNames = floor.rooms.map((r) => r.name).join(', ');
          return (
            <li key={floor.id} className="truncate">
              <span className="font-medium text-secondary">{floor.name}</span>
              <span aria-hidden="true"> — </span>
              {floor.rooms.length > 0 ? (
                <span>{roomNames}</span>
              ) : (
                <span className="italic">{t('setup.apply.summary.layoutEmptyFloor')}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InterfacesReview({
  interfaces,
}: {
  readonly interfaces: readonly InterfaceConfig[] | undefined;
}): ReactNode {
  const { t } = useTranslation();
  if (interfaces === undefined || interfaces.length === 0) return null;

  const ipSummary = (config: IpConfig | undefined): string => {
    if (config === undefined) return t('setup.apply.summary.notSet');
    const method = t(`setup.network.method.${config.method}`);
    if (config.method === 'static' && config.address !== undefined && config.address.length > 0) {
      return `${method} · ${config.address.join(', ')}`;
    }
    return method;
  };

  return (
    <>
      {interfaces.map((iface) => (
        <div
          key={iface.name}
          className="flex flex-col gap-0.5 border-t border-secondary py-2.5 text-sm"
        >
          <span className="font-medium text-secondary">{iface.name}</span>
          <span className="text-tertiary">
            {t('setup.network.ipv4.heading')}: {ipSummary(iface.ipv4)}
          </span>
          <span className="text-tertiary">
            {t('setup.network.ipv6.heading')}: {ipSummary(iface.ipv6)}
          </span>
        </div>
      ))}
    </>
  );
}

// Inline step glyphs — same convention as the wizard rail (keeps the
// @untitledui/icons dep out of apps/web).
function Glyph({ d }: { readonly d: string }): ReactNode {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const HomeGlyph = (): ReactNode => (
  <Glyph d="M9 22V12h6v10M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
);
const LayoutGlyph = (): ReactNode => <Glyph d="M3 4h18v16H3zM12 4v16" />;
const NetworkGlyph = (): ReactNode => (
  <Glyph d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
);
const SecurityGlyph = (): ReactNode => <Glyph d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
