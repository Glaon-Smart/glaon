// Network — wizard step between Security and Review (#629). Mirrors HA's
// Supervisor "Network" screen: a device hostname, per-interface tabs
// (end0 / wlan0), collapsible IPv4 + IPv6 panels (method + static
// address / gateway / DNS), and the Wi-Fi picker (moved here from the
// old terminal apply step).
//
// Collect-only by contract: everything the user enters is merged into the
// wizard's `collected` state via `onNext`. The destructive network
// handoff + the actual Supervisor push stay in the terminal Review step
// (#626 decision) — the user's commitment moment is still the network
// switch, not this screen.
//
// Per the API Error Toast Rule (CLAUDE.md), the Wi-Fi scan failure routes
// through useToast; per-field validation (bad hostname / IP) renders
// inline on the field.

import {
  InputBase,
  PasswordInput,
  Select,
  SelectItem,
  Tabs,
  TextField,
  useToast,
  type SelectItemType,
} from '@glaon/ui';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput, InterfaceConfig, IpConfig, IpMethod } from '@glaon/core/config';

import { wrapPassword } from '../wifi/wifi-crypto';
import { WizardBackButton } from '../wizard-back-button';
import { CollapsibleSection } from './collapsible-section';
import {
  DEFAULT_WIRELESS_INTERFACE,
  HOST_INFO_URL,
  NETWORK_INFO_URL,
  accesspointsUrl,
  findWirelessInterface,
  parseAccessPoints,
  parseHostname,
  parseInterfaces,
  type AccessPoint,
  type InterfaceInfo,
} from './network-api';
import {
  areNameserversValid,
  isCidr,
  isHostnameLabel,
  isPlainIp,
  splitNameservers,
} from './validation';

interface NetworkStepProps {
  readonly collected: DeviceConfigInput;
  readonly onNext: (partial: DeviceConfigInput) => void;
  readonly onBack?: () => void;
}

// ---- per-family form state (text fields; converted to IpConfig on submit) ----

type Family = 'ipv4' | 'ipv6';

interface IpFormState {
  readonly method: IpMethod;
  readonly address: string;
  readonly gateway: string;
  readonly nameservers: string;
}

type InterfaceForms = Record<string, { ipv4: IpFormState; ipv6: IpFormState }>;

const EMPTY_FORM: IpFormState = { method: 'auto', address: '', gateway: '', nameservers: '' };

function seedIpForm(config: IpConfig): IpFormState {
  return {
    method: config.method,
    address: config.address?.[0] ?? '',
    gateway: config.gateway ?? '',
    nameservers: config.nameservers?.join(', ') ?? '',
  };
}

function ipFormToConfig(form: IpFormState): IpConfig {
  if (form.method !== 'static') return { method: form.method };
  const address = form.address.trim();
  const gateway = form.gateway.trim();
  const nameservers = splitNameservers(form.nameservers);
  return {
    method: 'static',
    ...(address !== '' ? { address: [address] } : {}),
    ...(gateway !== '' ? { gateway } : {}),
    ...(nameservers.length > 0 ? { nameservers } : {}),
  };
}

interface FamilyErrors {
  readonly address?: string;
  readonly gateway?: string;
  readonly nameservers?: string;
}

type LoadState = 'loading' | 'ready' | 'unavailable' | 'error';

type WifiState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'success'; readonly networks: readonly AccessPoint[] }
  | { readonly kind: 'error' }
  | { readonly kind: 'unavailable' };

export function NetworkStep({ collected, onNext, onBack }: NetworkStepProps): ReactNode {
  const { t } = useTranslation();
  const toast = useToast();
  const hostnameLabelId = useId();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [interfaces, setInterfaces] = useState<readonly InterfaceInfo[]>([]);
  const [interfaceForms, setInterfaceForms] = useState<InterfaceForms>({});
  const [wirelessIface, setWirelessIface] = useState<string>(DEFAULT_WIRELESS_INTERFACE);

  const [hostname, setHostname] = useState<string>(collected.network?.hostname ?? '');
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Wi-Fi picker (moved from apply-step).
  const [wifiState, setWifiState] = useState<WifiState>({ kind: 'idle' });
  const [selectedSsid, setSelectedSsid] = useState<string>(collected.wifi?.ssid ?? '');
  const [draftPassword, setDraftPassword] = useState<string>('');

  // Seed interface IP forms: prefer what the wizard already collected on a
  // re-entry, else the live Supervisor values from /network/info.
  const seedForms = useCallback(
    (live: readonly InterfaceInfo[]): InterfaceForms => {
      const collectedByName = new Map<string, InterfaceConfig>(
        (collected.network?.interfaces ?? []).map((iface) => [iface.name, iface]),
      );
      const forms: InterfaceForms = {};
      for (const iface of live) {
        const prior = collectedByName.get(iface.name);
        forms[iface.name] = {
          ipv4: seedIpForm(prior?.ipv4 ?? iface.ipv4),
          ipv6: seedIpForm(prior?.ipv6 ?? iface.ipv6),
        };
      }
      return forms;
    },
    [collected.network?.interfaces],
  );

  const loadWifi = useCallback(
    async (iface: string) => {
      setWifiState({ kind: 'loading' });
      let response: Response;
      try {
        response = await fetch(accesspointsUrl(iface), { credentials: 'include' });
      } catch {
        setWifiState({ kind: 'error' });
        toast.show({
          intent: 'danger',
          title: t('setup.network.wifi.scanFailed.title'),
          description: t('setup.network.wifi.scanFailed.description'),
        });
        return;
      }
      if (response.status === 503) {
        setWifiState({ kind: 'unavailable' });
        return;
      }
      if (!response.ok) {
        setWifiState({ kind: 'error' });
        toast.show({
          intent: 'danger',
          title: t('setup.network.wifi.scanFailed.title'),
          description: t('setup.network.wifi.scanFailed.description'),
        });
        return;
      }
      setWifiState({
        kind: 'success',
        networks: parseAccessPoints(await response.json().catch(() => null)),
      });
    },
    [t, toast],
  );

  const load = useCallback(async () => {
    setLoadState('loading');
    let infoResponse: Response;
    try {
      infoResponse = await fetch(NETWORK_INFO_URL, { credentials: 'include' });
    } catch {
      setLoadState('error');
      return;
    }
    // 503 = supervisor-not-configured: this environment can't configure
    // the network (HA-less dev). Informational, not an error — the step
    // degrades to a notice and the user advances without network config.
    if (infoResponse.status === 503) {
      setLoadState('unavailable');
      return;
    }
    if (!infoResponse.ok) {
      setLoadState('error');
      return;
    }
    const infoJson: unknown = await infoResponse.json().catch(() => null);
    const live = parseInterfaces(infoJson);
    const iface = findWirelessInterface(infoJson);
    setInterfaces(live);
    setInterfaceForms(seedForms(live));
    setWirelessIface(iface);

    // Seed hostname from the host API only when the wizard hasn't already
    // collected one (re-entry keeps the user's edit).
    if (collected.network?.hostname === undefined) {
      try {
        const hostResponse = await fetch(HOST_INFO_URL, { credentials: 'include' });
        if (hostResponse.ok) {
          const parsed = parseHostname(await hostResponse.json().catch(() => null));
          if (parsed !== undefined) setHostname(parsed);
        }
      } catch {
        // Hostname is a nicety; a failed /host/info shouldn't block the step.
      }
    }

    setLoadState('ready');
    void loadWifi(iface);
  }, [collected.network?.hostname, loadWifi, seedForms]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateForm = useCallback((name: string, family: Family, next: IpFormState) => {
    setInterfaceForms((prev) => {
      const existing = prev[name] ?? { ipv4: EMPTY_FORM, ipv6: EMPTY_FORM };
      return { ...prev, [name]: { ...existing, [family]: next } };
    });
  }, []);

  // ---- validation ----

  const hostnameTrimmed = hostname.trim();
  const hostnameInvalid = submitted && hostnameTrimmed !== '' && !isHostnameLabel(hostnameTrimmed);
  const hostnameError = hostnameInvalid ? t('setup.network.hostname.invalid') : undefined;

  const familyErrors = useCallback(
    (form: IpFormState | undefined, family: Family): FamilyErrors => {
      if (!submitted || form?.method !== 'static') return {};
      const address = form.address.trim();
      const gateway = form.gateway.trim();
      const addressError =
        address === ''
          ? t('setup.network.address.required')
          : !isCidr(address, family)
            ? t('setup.network.address.invalid')
            : undefined;
      const gatewayError =
        gateway !== '' && !isPlainIp(gateway, family)
          ? t('setup.network.gateway.invalid')
          : undefined;
      const nameserversError = !areNameserversValid(form.nameservers, family)
        ? t('setup.network.dns.invalid')
        : undefined;
      return {
        ...(addressError !== undefined ? { address: addressError } : {}),
        ...(gatewayError !== undefined ? { gateway: gatewayError } : {}),
        ...(nameserversError !== undefined ? { nameservers: nameserversError } : {}),
      };
    },
    [submitted, t],
  );

  const hasErrors = useMemo(() => {
    if (hostnameTrimmed !== '' && !isHostnameLabel(hostnameTrimmed)) return true;
    return interfaces.some((iface) => {
      const form = interfaceForms[iface.name];
      for (const family of ['ipv4', 'ipv6'] as const) {
        const f = form?.[family];
        if (f?.method !== 'static') continue;
        if (f.address.trim() === '' || !isCidr(f.address.trim(), family)) return true;
        if (f.gateway.trim() !== '' && !isPlainIp(f.gateway.trim(), family)) return true;
        if (!areNameserversValid(f.nameservers, family)) return true;
      }
      return false;
    });
  }, [hostnameTrimmed, interfaces, interfaceForms]);

  const selectedNetwork = useMemo<AccessPoint | null>(() => {
    if (wifiState.kind !== 'success') return null;
    return wifiState.networks.find((n) => n.ssid === selectedSsid) ?? null;
  }, [wifiState, selectedSsid]);

  const handleNext = useCallback(async () => {
    if (loadState !== 'ready') {
      onNext({});
      return;
    }
    setSubmitted(true);
    if (hasErrors) return;

    const partial: DeviceConfigInput = {};

    const network: NonNullable<DeviceConfigInput['network']> = {};
    if (hostnameTrimmed !== '') network.hostname = hostnameTrimmed;
    const interfaceConfigs: InterfaceConfig[] = interfaces.map((iface) => {
      const form = interfaceForms[iface.name];
      return {
        name: iface.name,
        ipv4: ipFormToConfig(form?.ipv4 ?? EMPTY_FORM),
        ipv6: ipFormToConfig(form?.ipv6 ?? EMPTY_FORM),
      };
    });
    if (interfaceConfigs.length > 0) network.interfaces = interfaceConfigs;
    if (network.hostname !== undefined || network.interfaces !== undefined)
      partial.network = network;

    if (selectedNetwork !== null) {
      setIsSubmitting(true);
      const password = draftPassword.trim();
      const passwordCipher = password !== '' ? await wrapPassword(password) : '(unsecured)';
      partial.wifi = { ssid: selectedNetwork.ssid, passwordCipher };
    }

    onNext(partial);
  }, [
    draftPassword,
    hasErrors,
    hostnameTrimmed,
    interfaceForms,
    interfaces,
    loadState,
    onNext,
    selectedNetwork,
  ]);

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">{t('setup.network.title')}</h1>
        <p className="text-sm text-tertiary">{t('setup.network.subtitle')}</p>
      </header>

      {loadState === 'loading' && (
        <p role="status" className="text-sm text-tertiary">
          {t('setup.network.loading')}
        </p>
      )}
      {loadState === 'error' && <ErrorRetry onRetry={() => void load()} />}
      {loadState === 'unavailable' && (
        <div className="rounded-lg border border-secondary bg-secondary/50 p-4 text-sm text-tertiary">
          {t('setup.network.unavailable')}
        </div>
      )}

      {loadState === 'ready' && (
        <div className="flex flex-col">
          <FormRow label={t('setup.network.hostname.label')} labelId={hostnameLabelId}>
            <TextField
              value={hostname}
              onChange={setHostname}
              isInvalid={hostnameInvalid}
              aria-labelledby={hostnameLabelId}
            >
              <InputBase
                type="text"
                placeholder={t('setup.network.hostname.placeholder')}
                autoComplete="off"
                data-testid="network-hostname"
              />
            </TextField>
            <p className="text-xs text-tertiary">{t('setup.network.hostname.hint')}</p>
            {hostnameError !== undefined && <InlineError>{hostnameError}</InlineError>}
          </FormRow>

          <section
            aria-labelledby="network-interfaces-heading"
            className="flex flex-col gap-4 border-t border-secondary py-5"
          >
            <h2
              id="network-interfaces-heading"
              className="text-sm font-semibold uppercase tracking-wide text-tertiary"
            >
              {t('setup.network.interfaces.heading')}
            </h2>

            {interfaces.length > 0 && (
              <Tabs defaultSelectedKey={interfaces[0]?.name ?? ''}>
                <Tabs.List>
                  {interfaces.map((iface) => (
                    <Tabs.Trigger key={iface.name} id={iface.name} label={iface.name} />
                  ))}
                </Tabs.List>
                {interfaces.map((iface) => (
                  <Tabs.Content key={iface.name} id={iface.name}>
                    <div className="flex flex-col gap-4 pt-4">
                      {iface.type === 'wireless' && iface.name === wirelessIface && (
                        <WifiPicker
                          state={wifiState}
                          selectedSsid={selectedSsid}
                          draftPassword={draftPassword}
                          onSelect={(ssid) => {
                            setSelectedSsid(ssid);
                            setDraftPassword('');
                          }}
                          onPasswordChange={setDraftPassword}
                          onRetry={() => void loadWifi(iface.name)}
                        />
                      )}
                      <IpFamilyForm
                        family="ipv4"
                        form={interfaceForms[iface.name]?.ipv4}
                        errors={familyErrors(interfaceForms[iface.name]?.ipv4, 'ipv4')}
                        onChange={(next) => {
                          updateForm(iface.name, 'ipv4', next);
                        }}
                      />
                      <IpFamilyForm
                        family="ipv6"
                        form={interfaceForms[iface.name]?.ipv6}
                        errors={familyErrors(interfaceForms[iface.name]?.ipv6, 'ipv6')}
                        onChange={(next) => {
                          updateForm(iface.name, 'ipv6', next);
                        }}
                      />
                    </div>
                  </Tabs.Content>
                ))}
              </Tabs>
            )}
          </section>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-secondary py-6">
        {onBack !== undefined ? <WizardBackButton onBack={onBack} /> : <span />}
        <button
          type="button"
          onClick={() => void handleNext()}
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs-skeuomorphic hover:bg-brand-solid_hover disabled:opacity-60"
          data-testid="network-next"
        >
          <span>{t('setup.network.actions.next')}</span>
          <NextArrowIcon />
        </button>
      </div>
    </div>
  );
}

// =============================================================
// IP family form (one of IPv4 / IPv6), collapsible
// =============================================================

interface IpFamilyFormProps {
  readonly family: Family;
  readonly form: IpFormState | undefined;
  readonly errors: FamilyErrors;
  readonly onChange: (next: IpFormState) => void;
}

function IpFamilyForm({ family, form, errors, onChange }: IpFamilyFormProps): ReactNode {
  const { t } = useTranslation();
  const addressId = useId();
  const gatewayId = useId();
  const dnsId = useId();
  const methodId = useId();

  const current: IpFormState = form ?? {
    method: 'auto',
    address: '',
    gateway: '',
    nameservers: '',
  };

  const methodItems = useMemo<SelectItemType[]>(
    () => [
      { id: 'auto', label: t('setup.network.method.auto') },
      { id: 'static', label: t('setup.network.method.static') },
      { id: 'disabled', label: t('setup.network.method.disabled') },
    ],
    [t],
  );

  const title =
    family === 'ipv4' ? t('setup.network.ipv4.heading') : t('setup.network.ipv6.heading');
  const summary = t(`setup.network.method.${current.method}`);
  // Auto-open when the family is statically configured so the user sees
  // the fields without an extra click.
  const defaultOpen = current.method === 'static';

  return (
    <CollapsibleSection title={title} summary={summary} defaultOpen={defaultOpen}>
      <div className="flex flex-col gap-1.5">
        <label id={methodId} className="text-sm font-semibold text-secondary">
          {t('setup.network.method.label')}
        </label>
        <Select
          aria-labelledby={methodId}
          items={methodItems}
          value={current.method}
          onChange={(key) => {
            if (key === 'auto' || key === 'static' || key === 'disabled') {
              onChange({ ...current, method: key });
            }
          }}
        >
          {(item) => <SelectItem key={item.id} id={item.id} label={item.label ?? ''} />}
        </Select>
      </div>

      {current.method === 'static' && (
        <>
          <IpTextField
            id={addressId}
            label={t('setup.network.address.label')}
            placeholder={family === 'ipv4' ? '192.168.1.50/24' : 'fd00::50/64'}
            value={current.address}
            error={errors.address}
            onChange={(value) => {
              onChange({ ...current, address: value });
            }}
          />
          <IpTextField
            id={gatewayId}
            label={t('setup.network.gateway.label')}
            placeholder={family === 'ipv4' ? '192.168.1.1' : 'fd00::1'}
            value={current.gateway}
            error={errors.gateway}
            onChange={(value) => {
              onChange({ ...current, gateway: value });
            }}
          />
          <IpTextField
            id={dnsId}
            label={t('setup.network.dns.label')}
            placeholder={family === 'ipv4' ? '1.1.1.1, 8.8.8.8' : '2606:4700:4700::1111'}
            value={current.nameservers}
            error={errors.nameservers}
            onChange={(value) => {
              onChange({ ...current, nameservers: value });
            }}
          />
        </>
      )}
    </CollapsibleSection>
  );
}

interface IpTextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
}

function IpTextField({
  id,
  label,
  placeholder,
  value,
  error,
  onChange,
}: IpTextFieldProps): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <label id={id} className="text-sm font-semibold text-secondary">
        {label}
      </label>
      <TextField
        value={value}
        onChange={onChange}
        isInvalid={error !== undefined}
        aria-labelledby={id}
      >
        <InputBase type="text" placeholder={placeholder} autoComplete="off" />
      </TextField>
      {error !== undefined && <InlineError>{error}</InlineError>}
    </div>
  );
}

// =============================================================
// Wi-Fi picker (moved from apply-step.tsx)
// =============================================================

interface WifiPickerProps {
  readonly state: WifiState;
  readonly selectedSsid: string;
  readonly draftPassword: string;
  readonly onSelect: (ssid: string) => void;
  readonly onPasswordChange: (value: string) => void;
  readonly onRetry: () => void;
}

function WifiPicker({
  state,
  selectedSsid,
  draftPassword,
  onSelect,
  onPasswordChange,
  onRetry,
}: WifiPickerProps): ReactNode {
  const { t } = useTranslation();
  const passwordLabelId = useId();
  const wifiPicked =
    state.kind === 'success' && state.networks.some((n) => n.ssid === selectedSsid);

  return (
    <section aria-labelledby="network-wifi-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3
          id="network-wifi-heading"
          className="text-sm font-semibold uppercase tracking-wide text-tertiary"
        >
          {t('setup.network.wifi.heading')}
        </h3>
        <p className="text-sm text-tertiary">{t('setup.network.wifi.subtitle')}</p>
      </div>

      {state.kind === 'loading' && (
        <p role="status" className="text-sm text-tertiary">
          {t('setup.network.wifi.loading')}
        </p>
      )}
      {state.kind === 'unavailable' && (
        <div className="rounded-lg border border-secondary bg-secondary/50 p-4 text-sm text-tertiary">
          {t('setup.network.wifi.unavailable')}
        </div>
      )}
      {state.kind === 'error' && (
        <WifiNotice body={t('setup.network.wifi.scanFailed.body')} onRetry={onRetry} />
      )}
      {state.kind === 'success' && state.networks.length === 0 && (
        <WifiNotice body={t('setup.network.wifi.empty')} onRetry={onRetry} />
      )}
      {state.kind === 'success' && state.networks.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label={t('setup.network.wifi.list.ariaLabel')}>
          {state.networks.map((network) => (
            <li key={network.ssid}>
              <WifiNetworkRow
                network={network}
                isSelected={network.ssid === selectedSsid}
                onSelect={() => {
                  onSelect(network.ssid);
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
            {t('setup.network.wifi.password.label')}
          </label>
          <PasswordInput
            id={`${passwordLabelId}-input`}
            value={draftPassword}
            onChange={onPasswordChange}
            placeholder={t('setup.network.wifi.password.placeholder')}
            autoComplete="off"
          />
          <p className="text-xs text-tertiary">{t('setup.network.wifi.password.optionalHint')}</p>
        </div>
      )}
    </section>
  );
}

interface WifiNetworkRowProps {
  readonly network: AccessPoint;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}

function WifiNetworkRow({ network, isSelected, onSelect }: WifiNetworkRowProps): ReactNode {
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
        <WifiIcon />
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-sm font-medium leading-5 text-secondary">{network.ssid}</span>
        {network.signal !== undefined && (
          <span className="text-sm font-normal leading-5 text-tertiary">
            {t('setup.network.wifi.signal', { signal: network.signal })}
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

interface WifiNoticeProps {
  readonly body: string;
  readonly onRetry: () => void;
}

function WifiNotice({ body, onRetry }: WifiNoticeProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-primary p-4 text-sm text-tertiary">
      <p>{body}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-1.5 text-sm font-semibold text-secondary shadow-xs-skeuomorphic"
      >
        {t('setup.network.wifi.actions.retry')}
      </button>
    </div>
  );
}

// =============================================================
// Shared chrome (mirrors home-overview-step)
// =============================================================

interface FormRowProps {
  readonly label: string;
  readonly labelId?: string;
  readonly children: ReactNode;
}

function FormRow({ label, labelId, children }: FormRowProps): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-secondary py-5 sm:grid-cols-[240px_1fr] sm:items-start sm:gap-8">
      <p id={labelId} className="pt-2 text-sm font-semibold text-secondary">
        {label}
      </p>
      <div className="flex max-w-[480px] flex-col gap-1.5">{children}</div>
    </div>
  );
}

function InlineError({ children }: { children: ReactNode }): ReactNode {
  return (
    <p role="alert" className="text-sm text-error-primary">
      {children}
    </p>
  );
}

interface ErrorRetryProps {
  readonly onRetry: () => void;
}

function ErrorRetry({ onRetry }: ErrorRetryProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-secondary bg-primary p-4 text-sm text-tertiary">
      <p>{t('setup.network.loadFailed')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-1.5 text-sm font-semibold text-secondary shadow-xs-skeuomorphic"
      >
        {t('setup.network.wifi.actions.retry')}
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
