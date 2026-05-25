// Apply — terminal wizard step (#597). Collapses what used to be
// the Wi-Fi (#546) and Final Review (#548) steps into a single
// surface that:
//
//   1. Shows the user a read-only summary of everything they
//      entered in steps 1–3.
//   2. Lets them pick their home Wi-Fi network + password right
//      below the summary (the old wifi-step UI, embedded here).
//   3. Commits everything in one ceremony at click-time —
//      HandoffModal opens, user re-confirms password, HandoffOverlay
//      takes over while the device drops AP and joins the home
//      network. After the reload the user lands on /login.
//
// Why one step instead of two:
//
//   - The user's commitment moment IS the network switch. Splitting
//     "pick network" and "review + commit" across two screens put
//     the destructive action three steps after the decision, hiding
//     it behind a Review headline that read like an informational
//     summary.
//   - The wizard ends at the network handoff in every flow — there
//     is no "step 6" after a successful commit. A terminal step
//     should look terminal.
//
// Wi-Fi enumeration still goes through the HA Supervisor's
// `/api/hassio/network/info` endpoint. In standalone mode
// (`VITE_APP_MODE === 'standalone'`) the wifi block collapses to an
// informational placeholder and the CTA commits without a network
// change — same dev affordance #546 shipped with.
//
// Per the API Error Toast Rule (CLAUDE.md), commit failures surface
// through useToast; inline error blocks would mask the cross-section
// nature of the failure.

import { Button, PasswordInput, useToast } from '@glaon/ui';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput, Layout } from '@glaon/core/config';

import { useDeviceConfig } from '../../../config/config-provider';
import { clearWizardScratch } from '../../../setup/use-wizard-state';
import { HandoffModal } from '../wifi/handoff-modal';
import { HandoffOverlay } from '../wifi/handoff-overlay';
import { clearDeviceKey, wrapPassword } from '../wifi/wifi-crypto';

interface ApplyStepProps {
  /** Final accumulated partial from prior steps. */
  readonly collected: DeviceConfigInput;
  /** Hint from the wizard route that this is the last step (unused — the apply step owns its CTA copy). */
  readonly onNext?: (partial: DeviceConfigInput) => void;
}

// =============================================================
// Supervisor wiring (carried over from review-step + wifi-step)
// =============================================================

const SUPERVISOR_NETWORK_INTERFACE = 'wlan0';
const SUPERVISOR_NETWORK_UPDATE = `/api/hassio/network/${SUPERVISOR_NETWORK_INTERFACE}/update`;
const SUPERVISOR_NETWORK_INFO = '/api/hassio/network/info';

// Hard-coded URL the QR code encodes. The mDNS responder advertises
// the device under `glaon.local` on the home network (addon-side
// concern). Per-device hostnames (`glaon-<serial>.local`) are tracked
// in #594's open questions.
const DEVICE_URL_AFTER_HANDOFF = 'http://glaon.local';

function isStandaloneMode(): boolean {
  return import.meta.env.VITE_APP_MODE === 'standalone';
}

function isSecuredAuth(auth: string): boolean {
  return auth !== '' && auth.toLowerCase() !== 'none';
}

function isSecuredCipher(cipher: string | undefined): boolean {
  return cipher !== undefined && cipher !== '' && cipher !== '(unsecured)';
}

interface AccessPoint {
  readonly ssid: string;
  readonly auth: string;
}

type FetchState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'success'; readonly networks: readonly AccessPoint[] }
  | { readonly kind: 'error' }
  | { readonly kind: 'standalone' };

/**
 * Normalise the HA Supervisor `/api/hassio/network/info` response
 * into a flat, deduplicated list of access points. The endpoint
 * returns `{ data: { interfaces: [{ accesspoints: [...] }] } }` —
 * one entry per wireless interface; merge them.
 */
function parseAccessPoints(json: unknown): readonly AccessPoint[] {
  const root = json as
    | { data?: { interfaces?: readonly { accesspoints?: readonly unknown[] }[] } }
    | undefined;
  const interfaces = root?.data?.interfaces ?? [];
  const seen = new Set<string>();
  const out: AccessPoint[] = [];
  for (const iface of interfaces) {
    for (const raw of iface.accesspoints ?? []) {
      const ap = raw as { ssid?: unknown; auth?: unknown };
      const ssid = typeof ap.ssid === 'string' ? ap.ssid : '';
      const auth = typeof ap.auth === 'string' ? ap.auth : '';
      if (ssid === '' || seen.has(ssid)) continue;
      seen.add(ssid);
      out.push({ ssid, auth });
    }
  }
  return out;
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

// =============================================================
// Apply step
// =============================================================

type HandoffPhase = 'idle' | 'confirming' | 'committing' | 'switching';

export function ApplyStep({ collected }: ApplyStepProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const { setPartial, markComplete } = useDeviceConfig();
  const passwordLabelId = useId();

  // ---- Wi-Fi enumeration state (carried from wifi-step.tsx) ----

  const [fetchState, setFetchState] = useState<FetchState>(() =>
    isStandaloneMode() ? { kind: 'standalone' } : { kind: 'loading' },
  );
  const [selectedSsid, setSelectedSsid] = useState<string>(collected.wifi?.ssid ?? '');
  const [draftPassword, setDraftPassword] = useState<string>('');

  const loadNetworks = useCallback(async () => {
    setFetchState({ kind: 'loading' });
    try {
      const response = await fetch(SUPERVISOR_NETWORK_INFO, { credentials: 'include' });
      if (!response.ok) throw new Error(`Supervisor responded ${String(response.status)}`);
      const json: unknown = await response.json();
      setFetchState({ kind: 'success', networks: parseAccessPoints(json) });
    } catch {
      setFetchState({ kind: 'error' });
      toast.show({
        intent: 'danger',
        title: t('setup.apply.wifi.scanFailed.title'),
        description: t('setup.apply.wifi.scanFailed.description'),
      });
    }
  }, [t, toast]);

  useEffect(() => {
    if (isStandaloneMode()) return;
    void loadNetworks();
  }, [loadNetworks]);

  const selectedNetwork = useMemo<AccessPoint | null>(() => {
    if (fetchState.kind !== 'success') return null;
    return fetchState.networks.find((n) => n.ssid === selectedSsid) ?? null;
  }, [fetchState, selectedSsid]);

  const passwordRequired = selectedNetwork !== null && isSecuredAuth(selectedNetwork.auth);
  const wifiPicked = selectedNetwork !== null;

  // ---- Commit ceremony state (carried from review-step.tsx) ----

  const [handoffPhase, setHandoffPhase] = useState<HandoffPhase>('idle');
  const isCommitting = handoffPhase === 'committing';

  // CTA enablement: standalone mode commits without wifi; otherwise
  // wait for a picked network and (if secured) the inline password.
  const ctaDisabled =
    isCommitting ||
    (fetchState.kind !== 'standalone' &&
      (!wifiPicked || (passwordRequired && draftPassword.trim() === '')));

  const onApplyClick = (): void => {
    if (ctaDisabled) return;
    if (passwordRequired) {
      // Secured wifi → open handoff modal so the user re-confirms the
      // password and reads the disconnect warning.
      setHandoffPhase('confirming');
      return;
    }
    // Open / no-wifi networks skip the modal (no password to
    // re-confirm, no AP→home handoff to warn about for the no-wifi
    // case).
    void runCommit('');
  };

  const onHandoffConfirm = (password: string): void => {
    if (passwordRequired && password.trim() === '') return;
    void runCommit(password);
  };

  async function runCommit(secureWifiPassword: string): Promise<void> {
    setHandoffPhase('committing');
    try {
      // The plaintext password lives in the modal's confirm field
      // (`secureWifiPassword`) — used as-is for the supervisor POST
      // (the wire format expects plaintext PSK), then wrapped via
      // Web Crypto AES-GCM before it lands in the persisted blob
      // (#595, Security-First Rule "no plaintext credentials").
      const secured = passwordRequired;
      const password = secured ? secureWifiPassword : '';
      if (secured && password === '') {
        throw new Error('missing wifi password');
      }

      if (selectedNetwork !== null) {
        await pushWifiToSupervisor({ ssid: selectedNetwork.ssid, password, secured });
        const persistedCipher = secured ? await wrapPassword(password) : '(unsecured)';
        await setPartial({
          ...collected,
          wifi: { ssid: selectedNetwork.ssid, passwordCipher: persistedCipher },
        });
      } else {
        await setPartial(collected);
      }
      await markComplete();
      // Wizard is complete — drop the scratch entry + wrap key so a
      // future visit to the URL never resurrects this run's state.
      clearWizardScratch();
      clearDeviceKey();
      // `passwordRequired` already implies `selectedNetwork !== null`
      // (see its derivation above), so the wifi handoff overlay path
      // matches the secured-network case 1:1.
      if (passwordRequired) {
        setHandoffPhase('switching');
        // Defer the reload by a moment so the user catches a beat of
        // the HandoffOverlay before the page goes away. In practice
        // the addon drops the AP first.
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        window.location.reload();
      }
    } catch {
      // Secured-wifi failure re-opens the modal so the user can
      // retry / re-enter the password; everything else returns to
      // idle since there's no modal to re-open. Toast fires in both.
      setHandoffPhase(passwordRequired ? 'confirming' : 'idle');
      toast.show({
        intent: 'danger',
        title: t('setup.apply.commitFailed.title'),
        description: t('setup.apply.commitFailed.description'),
      });
    }
  }

  // ---- Derived summary value for the embedded Wi-Fi row ----

  const wifiSummaryValue = wifiPicked
    ? passwordRequired
      ? t('setup.apply.summary.wifiSecured', { ssid: selectedNetwork.ssid })
      : t('setup.apply.summary.wifiUnsecured', { ssid: selectedNetwork.ssid })
    : collected.wifi !== undefined
      ? isSecuredCipher(collected.wifi.passwordCipher)
        ? t('setup.apply.summary.wifiSecured', { ssid: collected.wifi.ssid })
        : t('setup.apply.summary.wifiUnsecured', { ssid: collected.wifi.ssid })
      : undefined;

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">{t('setup.apply.title')}</h1>
        <p className="text-sm text-tertiary">{t('setup.apply.subtitle')}</p>
      </header>

      {/* === Summary === */}
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

      {/* === Wi-Fi picker === */}
      <section
        aria-labelledby="apply-wifi-heading"
        className="mt-8 flex flex-col gap-4 border-t border-secondary pt-6"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="apply-wifi-heading"
            className="text-sm font-semibold uppercase tracking-wide text-tertiary"
          >
            {t('setup.apply.wifi.heading')}
          </h2>
          <p className="text-sm text-tertiary">{t('setup.apply.wifi.subtitle')}</p>
        </div>

        {fetchState.kind === 'standalone' && <StandaloneNotice />}
        {fetchState.kind === 'loading' && <LoadingNotice />}
        {fetchState.kind === 'error' && <ErrorRetry onRetry={() => void loadNetworks()} />}
        {fetchState.kind === 'success' && fetchState.networks.length === 0 && (
          <EmptyNotice onRetry={() => void loadNetworks()} />
        )}
        {fetchState.kind === 'success' && fetchState.networks.length > 0 && (
          <ul className="flex flex-col gap-3" aria-label={t('setup.apply.wifi.list.ariaLabel')}>
            {fetchState.networks.map((network) => (
              <li key={network.ssid}>
                <WifiNetworkRow
                  network={network}
                  isSelected={network.ssid === selectedSsid}
                  onSelect={() => {
                    setSelectedSsid(network.ssid);
                    setDraftPassword('');
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {passwordRequired && (
          <div className="flex max-w-[480px] flex-col gap-1.5">
            <label
              id={passwordLabelId}
              className="text-sm font-semibold text-secondary"
              htmlFor={`${passwordLabelId}-input`}
            >
              {t('setup.apply.wifi.password.label')}
            </label>
            <PasswordInput
              id={`${passwordLabelId}-input`}
              value={draftPassword}
              onChange={setDraftPassword}
              placeholder={t('setup.apply.wifi.password.placeholder')}
              autoComplete="off"
            />
            <p className="text-xs text-tertiary">{t('setup.apply.wifi.password.hint')}</p>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-3 border-t border-secondary py-6 mt-4">
        <Button
          size="md"
          color="primary"
          onClick={onApplyClick}
          isLoading={isCommitting}
          isDisabled={ctaDisabled}
        >
          {t('setup.apply.actions.save')}
        </Button>
      </div>

      <HandoffModal
        isOpen={handoffPhase === 'confirming' || handoffPhase === 'committing'}
        onOpenChange={(open) => {
          if (!open) setHandoffPhase('idle');
        }}
        ssid={selectedNetwork?.ssid ?? ''}
        requiresPassword={passwordRequired}
        deviceUrl={DEVICE_URL_AFTER_HANDOFF}
        onConfirm={onHandoffConfirm}
        isCommitting={isCommitting}
      />

      {handoffPhase === 'switching' && (
        <HandoffOverlay ssid={selectedNetwork?.ssid ?? ''} deviceUrl={DEVICE_URL_AFTER_HANDOFF} />
      )}
    </div>
  );
}

// =============================================================
// Sub-components — kept inline (private to this step) until a
// second consumer arrives.
// =============================================================

interface WifiNetworkRowProps {
  readonly network: AccessPoint;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}

function WifiNetworkRow({ network, isSelected, onSelect }: WifiNetworkRowProps): ReactNode {
  const { t } = useTranslation();
  const secured = isSecuredAuth(network.auth);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`flex w-full items-start gap-4 rounded-xl border border-secondary p-4 text-left transition-colors hover:bg-secondary ${
        isSelected ? 'bg-[var(--glaon-light-grey)]' : 'bg-primary'
      }`}
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-secondary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset"
      >
        {secured ? <LockIcon /> : <LockUnlockedIcon />}
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-sm font-medium leading-5 text-secondary">{network.ssid}</span>
        <span className="text-sm font-normal leading-5 text-tertiary">
          {secured ? network.auth.toUpperCase() : t('setup.apply.wifi.unsecured')}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${
          isSelected ? 'border-brand-solid bg-brand-solid' : 'border-secondary bg-primary'
        }`}
      >
        {isSelected && <span className="block size-1.5 rounded-full bg-primary" />}
      </span>
    </button>
  );
}

function StandaloneNotice(): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-secondary bg-secondary/50 p-4 text-sm text-tertiary">
      {t('setup.apply.wifi.standalone')}
    </div>
  );
}

function LoadingNotice(): ReactNode {
  const { t } = useTranslation();
  return (
    <div role="status" className="text-sm text-tertiary">
      {t('setup.apply.wifi.loading')}
    </div>
  );
}

interface RetryProps {
  readonly onRetry: () => void;
}

function ErrorRetry({ onRetry }: RetryProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-primary p-4 text-sm text-tertiary">
      <p>{t('setup.apply.wifi.scanFailed.body')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-1.5 text-sm font-semibold text-secondary shadow-xs-skeuomorphic"
      >
        {t('setup.apply.wifi.actions.retry')}
      </button>
    </div>
  );
}

function EmptyNotice({ onRetry }: RetryProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-primary p-4 text-sm text-tertiary">
      <p>{t('setup.apply.wifi.empty')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-1.5 text-sm font-semibold text-secondary shadow-xs-skeuomorphic"
      >
        {t('setup.apply.wifi.actions.retry')}
      </button>
    </div>
  );
}

function LockIcon(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.667" y="7.333" width="10.667" height="6.667" rx="1.333" />
      <path d="M4.667 7.333V4.667a3.333 3.333 0 0 1 6.666 0v2.666" />
    </svg>
  );
}

function LockUnlockedIcon(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.667" y="7.333" width="10.667" height="6.667" rx="1.333" />
      <path d="M4.667 7.333V4.667a3.333 3.333 0 0 1 6.666 0" />
    </svg>
  );
}

// =============================================================
// Summary rows (carried from review-step.tsx)
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
