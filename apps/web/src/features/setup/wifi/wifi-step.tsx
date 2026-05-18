// Wi-Fi Configuration wizard step — third step in the device setup
// wizard (epic #533, ADR 0028). Pixel-matched to Figma node
// 14867:39794. Replaces the placeholder from #539.
//
// Browsers cannot enumerate Wi-Fi networks, so this step delegates to
// the HA Supervisor `/api/hassio/network/info` endpoint. That endpoint
// is only reachable when Glaon runs as the HA Add-on (Ingress / kiosk
// modes); in `standalone` mode the step renders an informational
// placeholder and `onNext` advances without storing anything.
//
// State design per #546:
// - Loading → spinner while the fetch resolves.
// - Empty → no access points returned.
// - Error → Toast (`useToast({ intent: 'danger' })`) per the API Error
//   Toast Rule (CLAUDE.md). The body still renders an inline retry
//   affordance so the user has somewhere to go without dismissing the
//   toast.
// - Populated → list of radio cards (Figma 14867:39794).
// - Selected + secured → a PasswordInput appears below the list.
// - Standalone-mode → informational block instead of fetch + list.
//
// Selected SSID + password live in route-local `useState` only — the
// step pushes `{ wifi: { ssid, passwordCipher: <plaintext for now> } }`
// into `collected` via `onNext`, and the Final Review step (#548) is
// the only place that calls `markComplete()` + writes the blob to
// localStorage. v1 stores the plaintext password as the "cipher" so
// the shape lines up; #548 wraps it before it reaches disk.

import { PasswordInput, useToast } from '@glaon/ui';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  type SubmitEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput } from '@glaon/core/config';

interface WifiStepProps {
  /** Partial DeviceConfig collected from earlier steps in this run. */
  readonly collected: DeviceConfigInput;
  /** Merge the form's output into `collected` and advance. */
  readonly onNext: (partial: DeviceConfigInput) => void;
}

interface AccessPoint {
  readonly ssid: string;
  /**
   * Authentication tag from the HA Supervisor payload (e.g. `wpa-psk`,
   * `none`). Empty string is treated as "unsecured".
   */
  readonly auth: string;
}

type FetchState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'success'; readonly networks: readonly AccessPoint[] }
  | { readonly kind: 'error' }
  | { readonly kind: 'standalone' };

const NETWORK_INFO_ENDPOINT = '/api/hassio/network/info';

function isStandaloneMode(): boolean {
  return import.meta.env.VITE_APP_MODE === 'standalone';
}

function isSecured(auth: string): boolean {
  return auth !== '' && auth.toLowerCase() !== 'none';
}

/**
 * Normalise the HA Supervisor `/api/hassio/network/info` response into a
 * flat, deduplicated list of access points. The endpoint returns a
 * wrapper `{ data: { interfaces: [{ accesspoints: [...] }] } }` with
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

export function WifiStep({ collected, onNext }: WifiStepProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const passwordLabelId = useId();
  const [fetchState, setFetchState] = useState<FetchState>(() =>
    isStandaloneMode() ? { kind: 'standalone' } : { kind: 'loading' },
  );
  const [selectedSsid, setSelectedSsid] = useState<string>(collected.wifi?.ssid ?? '');
  const [password, setPassword] = useState<string>('');

  const loadNetworks = useCallback(async () => {
    setFetchState({ kind: 'loading' });
    try {
      const response = await fetch(NETWORK_INFO_ENDPOINT, { credentials: 'include' });
      if (!response.ok) throw new Error(`Supervisor responded ${String(response.status)}`);
      const json: unknown = await response.json();
      setFetchState({ kind: 'success', networks: parseAccessPoints(json) });
    } catch {
      setFetchState({ kind: 'error' });
      toast.show({
        intent: 'danger',
        title: t('setup.wifi.scanFailed.title'),
        description: t('setup.wifi.scanFailed.description'),
      });
    }
  }, [t, toast]);

  useEffect(() => {
    if (isStandaloneMode()) return;
    void loadNetworks();
  }, [loadNetworks]);

  const selectedNetwork = useMemo(
    () =>
      fetchState.kind === 'success'
        ? (fetchState.networks.find((n) => n.ssid === selectedSsid) ?? null)
        : null,
    [fetchState, selectedSsid],
  );

  const passwordRequired = selectedNetwork !== null && isSecured(selectedNetwork.auth);
  const nextDisabled =
    fetchState.kind !== 'standalone' &&
    (selectedNetwork === null || (passwordRequired && password.trim() === ''));

  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (fetchState.kind === 'standalone' || selectedNetwork === null) {
      onNext({});
      return;
    }
    // v1 stores the plaintext password as the "cipher" placeholder —
    // #548 (Final Review commit) wraps it before the value ever leaves
    // route-local memory. The schema's `passwordCipher: string` is opaque
    // to @glaon/core; the wrapping concern belongs to the consumer.
    const cipher = passwordRequired ? password : '(unsecured)';
    onNext({
      wifi: { ssid: selectedNetwork.ssid, passwordCipher: cipher },
    });
  };

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">{t('setup.wifi.title')}</h1>
        <p className="text-sm text-tertiary">{t('setup.wifi.subtitle')}</p>
      </header>

      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-5 border-t border-secondary pt-6"
      >
        {fetchState.kind === 'standalone' && <StandaloneNotice />}
        {fetchState.kind === 'loading' && <LoadingNotice />}
        {fetchState.kind === 'error' && <ErrorRetry onRetry={() => void loadNetworks()} />}
        {fetchState.kind === 'success' && fetchState.networks.length === 0 && (
          <EmptyNotice onRetry={() => void loadNetworks()} />
        )}
        {fetchState.kind === 'success' && fetchState.networks.length > 0 && (
          <ul className="flex flex-col gap-5" aria-label={t('setup.wifi.list.ariaLabel')}>
            {fetchState.networks.map((network) => (
              <li key={network.ssid}>
                <WifiNetworkRow
                  network={network}
                  isSelected={network.ssid === selectedSsid}
                  onSelect={() => {
                    setSelectedSsid(network.ssid);
                    setPassword('');
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
              {t('setup.wifi.password.label')}
            </label>
            <PasswordInput
              id={`${passwordLabelId}-input`}
              value={password}
              onChange={setPassword}
              placeholder={t('setup.wifi.password.placeholder')}
              autoComplete="off"
            />
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-secondary py-6">
          <button
            type="submit"
            disabled={nextDisabled}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs-skeuomorphic hover:bg-brand-solid_hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{t('setup.wifi.actions.next')}</span>
            <NextArrowIcon />
          </button>
        </div>
      </form>
    </div>
  );
}

interface WifiNetworkRowProps {
  readonly network: AccessPoint;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}

function WifiNetworkRow({ network, isSelected, onSelect }: WifiNetworkRowProps): ReactNode {
  const secured = isSecured(network.auth);
  const { t } = useTranslation();
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
          {secured ? network.auth.toUpperCase() : t('setup.wifi.unsecured')}
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
      {t('setup.wifi.standalone')}
    </div>
  );
}

function LoadingNotice(): ReactNode {
  const { t } = useTranslation();
  return (
    <div role="status" className="text-sm text-tertiary">
      {t('setup.wifi.loading')}
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
      <p>{t('setup.wifi.scanFailed.body')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-1.5 text-sm font-semibold text-secondary shadow-xs-skeuomorphic"
      >
        {t('setup.wifi.actions.retry')}
      </button>
    </div>
  );
}

function EmptyNotice({ onRetry }: RetryProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-primary p-4 text-sm text-tertiary">
      <p>{t('setup.wifi.empty')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-1.5 text-sm font-semibold text-secondary shadow-xs-skeuomorphic"
      >
        {t('setup.wifi.actions.retry')}
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

function NextArrowIcon(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.167 10h11.666m0 0L10 4.167M15.833 10 10 15.833" />
    </svg>
  );
}
