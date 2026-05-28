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
// Wi-Fi enumeration goes through `/api/hassio/network/info`. Whether a
// scan is possible is decided at runtime by the *server*, not a build
// flag (#619): apps/api (or the add-on's nginx) proxies the request to
// a real HA Supervisor. The apply step always attempts the scan and
// reacts to the response — 200 shows networks, 503
// (`supervisor-not-configured`) means this environment genuinely can't
// scan (an HA-less dev box) so the Wi-Fi step degrades to an
// informational notice and the CTA commits without a network change.
// There is deliberately no `VITE_APP_MODE` gate here: the end user
// never perceives Glaon as "an add-on", so availability can't hang off
// the build target.
//
// Per the API Error Toast Rule (CLAUDE.md), commit failures surface
// through useToast; inline error blocks would mask the cross-section
// nature of the failure.

import { Button, PasswordInput, useToast } from '@glaon/ui';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApplyHaResponse } from '@glaon/core/api-client';
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

const SUPERVISOR_NETWORK_INFO = '/api/hassio/network/info';
const DEFAULT_WIRELESS_INTERFACE = 'wlan0';

// HA Supervisor's scan results + commit are per-interface and carry the
// canonical `/interface/` segment (#622). The AP list is NOT in
// /network/info — it lives on the accesspoints endpoint.
const networkAccesspointsUrl = (iface: string): string =>
  `/api/hassio/network/interface/${encodeURIComponent(iface)}/accesspoints`;
const networkUpdateUrl = (iface: string): string =>
  `/api/hassio/network/interface/${encodeURIComponent(iface)}/update`;

// #617 — apps/api endpoint that pushes the collected home settings into
// HA Core (config/core/update + floor/area registry) over WebSocket.
const HA_APPLY_SETTINGS = '/api/setup/apply-ha';

// Hard-coded URL the QR code encodes. The mDNS responder advertises
// the device under `glaon.local` on the home network (addon-side
// concern). Per-device hostnames (`glaon-<serial>.local`) are tracked
// in #594's open questions.
const DEVICE_URL_AFTER_HANDOFF = 'http://glaon.local';

function isSecuredCipher(cipher: string | undefined): boolean {
  return cipher !== undefined && cipher !== '' && cipher !== '(unsecured)';
}

// Scan results carry no security/auth field (#622) — only signal. We
// can't tell secured from open networks; the password field decides.
interface AccessPoint {
  readonly ssid: string;
  readonly signal?: number;
}

type FetchState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'success'; readonly networks: readonly AccessPoint[] }
  | { readonly kind: 'error' }
  // Server answered 503 supervisor-not-configured: no scan possible in
  // this environment (HA-less dev). Informational, not an error.
  | { readonly kind: 'unavailable' };

/**
 * Pick the wireless interface from a `/network/info` payload
 * (`{ data: { interfaces: [{ interface, type }] } }`). Falls back to
 * `wlan0` when discovery is inconclusive — matches the device default.
 */
function findWirelessInterface(json: unknown): string {
  const root = json as
    | { data?: { interfaces?: readonly { interface?: unknown; type?: unknown }[] } }
    | undefined;
  for (const iface of root?.data?.interfaces ?? []) {
    if (
      iface.type === 'wireless' &&
      typeof iface.interface === 'string' &&
      iface.interface !== ''
    ) {
      return iface.interface;
    }
  }
  return DEFAULT_WIRELESS_INTERFACE;
}

/**
 * Normalise the Supervisor accesspoints response
 * (`{ data: { accesspoints: [{ ssid, mac, signal, ... }] } }`) into a
 * deduplicated AP list. Dedup by SSID keeping the strongest signal;
 * sort strongest-first.
 */
function parseAccessPoints(json: unknown): readonly AccessPoint[] {
  const root = json as { data?: { accesspoints?: readonly unknown[] } } | undefined;
  const bySsid = new Map<string, AccessPoint>();
  for (const raw of root?.data?.accesspoints ?? []) {
    const ap = raw as { ssid?: unknown; signal?: unknown };
    const ssid = typeof ap.ssid === 'string' ? ap.ssid : '';
    if (ssid === '') continue;
    const signal = typeof ap.signal === 'number' ? ap.signal : undefined;
    const existing = bySsid.get(ssid);
    if (existing === undefined || (signal ?? -Infinity) > (existing.signal ?? -Infinity)) {
      bySsid.set(ssid, signal === undefined ? { ssid } : { ssid, signal });
    }
  }
  return [...bySsid.values()].sort((a, b) => (b.signal ?? -Infinity) - (a.signal ?? -Infinity));
}

interface PushWifiArgs {
  readonly iface: string;
  readonly ssid: string;
  readonly password: string;
  readonly secured: boolean;
}

async function pushWifiToSupervisor({
  iface,
  ssid,
  password,
  secured,
}: PushWifiArgs): Promise<void> {
  const body = secured
    ? { wifi: { mode: 'infrastructure', auth: 'wpa-psk', ssid, psk: password } }
    : { wifi: { mode: 'infrastructure', auth: 'open', ssid } };
  const response = await fetch(networkUpdateUrl(iface), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Supervisor responded ${String(response.status)}`);
  }
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

/**
 * POST the wizard's home settings to apps/api, which pushes them into HA
 * Core over WebSocket. The room/floor extras (ids, room `type`) ride
 * along — apps/api's Zod schema strips anything it doesn't consume.
 * Non-blocking by contract: callers decide what a non-`ok`/`skipped`
 * outcome means for the commit ceremony.
 */
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

  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'loading' });
  const [selectedSsid, setSelectedSsid] = useState<string>(collected.wifi?.ssid ?? '');
  const [draftPassword, setDraftPassword] = useState<string>('');
  // Wireless interface discovered from /network/info; used for both the
  // accesspoints scan and the commit. Defaults to wlan0 until discovered.
  const [wirelessIface, setWirelessIface] = useState<string>(DEFAULT_WIRELESS_INTERFACE);

  const failScan = useCallback(() => {
    setFetchState({ kind: 'error' });
    toast.show({
      intent: 'danger',
      title: t('setup.apply.wifi.scanFailed.title'),
      description: t('setup.apply.wifi.scanFailed.description'),
    });
  }, [t, toast]);

  const loadNetworks = useCallback(async () => {
    setFetchState({ kind: 'loading' });

    // Step 1: discover the wireless interface from /network/info.
    let iface = DEFAULT_WIRELESS_INTERFACE;
    let infoResponse: Response;
    try {
      infoResponse = await fetch(SUPERVISOR_NETWORK_INFO, { credentials: 'include' });
    } catch {
      failScan();
      return;
    }
    // 503 = supervisor-not-configured. The scan genuinely can't run in
    // this environment (HA-less dev). Expected, handled — inline notice,
    // no danger toast.
    if (infoResponse.status === 503) {
      setFetchState({ kind: 'unavailable' });
      return;
    }
    if (infoResponse.ok) {
      iface = findWirelessInterface(await infoResponse.json().catch(() => null));
    }
    // A non-ok, non-503 /network/info falls through to the wlan0 default
    // and still attempts the scan — the accesspoints call is the real
    // signal of whether scanning works.
    setWirelessIface(iface);

    // Step 2: scan that interface's access points (the real AP list).
    let apResponse: Response;
    try {
      apResponse = await fetch(networkAccesspointsUrl(iface), { credentials: 'include' });
    } catch {
      failScan();
      return;
    }
    if (apResponse.status === 503) {
      setFetchState({ kind: 'unavailable' });
      return;
    }
    if (!apResponse.ok) {
      failScan();
      return;
    }
    const json: unknown = await apResponse.json().catch(() => null);
    setFetchState({ kind: 'success', networks: parseAccessPoints(json) });
  }, [failScan]);

  useEffect(() => {
    void loadNetworks();
  }, [loadNetworks]);

  const selectedNetwork = useMemo<AccessPoint | null>(() => {
    if (fetchState.kind !== 'success') return null;
    return fetchState.networks.find((n) => n.ssid === selectedSsid) ?? null;
  }, [fetchState, selectedSsid]);

  const wifiPicked = selectedNetwork !== null;
  // Scan results carry no security info (#622), so "secured" is decided
  // by whether the user typed a password — non-empty → WPA-PSK, empty →
  // open. The password field is always optional for a picked network.
  const passwordProvided = draftPassword.trim() !== '';

  // ---- Commit ceremony state (carried from review-step.tsx) ----

  const [handoffPhase, setHandoffPhase] = useState<HandoffPhase>('idle');
  const isCommitting = handoffPhase === 'committing';

  // CTA enablement: when the scan is unavailable (HA-less env) the user
  // commits without a network change; otherwise just need a picked
  // network (the password is optional — open networks exist and the scan
  // can't tell us which is secured).
  const ctaDisabled = isCommitting || (fetchState.kind !== 'unavailable' && !wifiPicked);

  const onApplyClick = (): void => {
    if (ctaDisabled) return;
    if (passwordProvided) {
      // A password was entered → treat as secured: open the handoff modal
      // so the user re-confirms the password and reads the disconnect
      // warning.
      setHandoffPhase('confirming');
      return;
    }
    // No password → open network (or no-wifi). Commit directly.
    void runCommit('');
  };

  const onHandoffConfirm = (password: string): void => {
    if (password.trim() === '') return;
    void runCommit(password);
  };

  async function runCommit(secureWifiPassword: string): Promise<void> {
    setHandoffPhase('committing');

    // Push home settings to HA *before* the Wi-Fi handoff (#617). This
    // step is non-destructive and the network is still stable, so a
    // failure can abort cleanly before we switch Wi-Fi. A `skipped`
    // outcome (apps/api has no HA Core configured — dev, 503) is fine
    // and proceeds silently; only a hard failure / partial apply stops
    // the ceremony so the user can retry without a half-applied home.
    // No build-flag guard (#619): pushSettingsToHa's own 503→skipped
    // handling covers the HA-less environment.
    const haOutcome = await pushSettingsToHa(collected);
    if (haOutcome.kind === 'error' || haOutcome.kind === 'partial') {
      setHandoffPhase(secureWifiPassword.trim() !== '' ? 'confirming' : 'idle');
      toast.show({
        intent: 'danger',
        title: t('setup.apply.haSettingsFailed.title'),
        description: t('setup.apply.haSettingsFailed.description'),
      });
      return;
    }

    try {
      // The plaintext password comes from the modal's confirm field
      // (`secureWifiPassword`) — used as-is for the supervisor POST
      // (the wire format expects plaintext PSK), then wrapped via
      // Web Crypto AES-GCM before it lands in the persisted blob
      // (#595, Security-First Rule "no plaintext credentials").
      // "secured" is decided by password presence (#622) — the scan
      // can't tell us the network's security type.
      const password = secureWifiPassword;
      const secured = password.trim() !== '';

      if (selectedNetwork !== null) {
        await pushWifiToSupervisor({
          iface: wirelessIface,
          ssid: selectedNetwork.ssid,
          password,
          secured,
        });
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
      // Secured (password-bearing) commits route through the handoff
      // overlay — that's the AP→home disconnect moment. Open / no-wifi
      // commits reload straight away.
      if (secured) {
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
      setHandoffPhase(secureWifiPassword.trim() !== '' ? 'confirming' : 'idle');
      toast.show({
        intent: 'danger',
        title: t('setup.apply.commitFailed.title'),
        description: t('setup.apply.commitFailed.description'),
      });
    }
  }

  // ---- Derived summary value for the embedded Wi-Fi row ----

  const wifiSummaryValue = wifiPicked
    ? passwordProvided
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

        {fetchState.kind === 'unavailable' && <UnavailableNotice />}
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
        {wifiPicked && (
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
            {/* No security info in scan results (#622) — the field is
                optional; an empty password commits as an open network. */}
            <p className="text-xs text-tertiary">{t('setup.apply.wifi.password.optionalHint')}</p>
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
        requiresPassword={passwordProvided}
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
  // Scan results carry no security type (#622); the secondary line shows
  // signal strength instead, mirroring HA's own network UI.
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
        <WifiIcon />
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-sm font-medium leading-5 text-secondary">{network.ssid}</span>
        {network.signal !== undefined && (
          <span className="text-sm font-normal leading-5 text-tertiary">
            {t('setup.apply.wifi.signal', { signal: network.signal })}
          </span>
        )}
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

function UnavailableNotice(): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-secondary bg-secondary/50 p-4 text-sm text-tertiary">
      {t('setup.apply.wifi.unavailable')}
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

function WifiIcon(): ReactNode {
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
      <path d="M1.667 6a9 9 0 0 1 12.666 0" />
      <path d="M4 8.667a5.333 5.333 0 0 1 8 0" />
      <path d="M6.333 11.333a2 2 0 0 1 3.334 0" />
      <path d="M8 14h.007" />
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
