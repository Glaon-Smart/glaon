// Supervisor HTTP + response parsing for the wizard's Network step (#629)
// and the terminal commit (#629/#597). Whether a call succeeds is decided
// at runtime by the *server* (apps/api or the add-on's nginx proxying a
// real HA Supervisor) — see docs/dev-supervisor.md. A 503
// (`supervisor-not-configured`) means this environment genuinely can't
// reach a Supervisor (HA-less dev); callers degrade gracefully.

import type { IpConfig, IpMethod } from '@glaon/core/config';

export const NETWORK_INFO_URL = '/api/hassio/network/info';
export const HOST_INFO_URL = '/api/hassio/host/info';
const HOST_OPTIONS_URL = '/api/hassio/host/options';
export const DEFAULT_WIRELESS_INTERFACE = 'wlan0';

export const accesspointsUrl = (iface: string): string =>
  `/api/hassio/network/interface/${encodeURIComponent(iface)}/accesspoints`;
const interfaceUpdateUrl = (iface: string): string =>
  `/api/hassio/network/interface/${encodeURIComponent(iface)}/update`;

// Scan results carry no security/auth field (#622) — only signal. We
// can't tell secured from open networks; the password field decides.
export interface AccessPoint {
  readonly ssid: string;
  readonly signal?: number;
}

/** A `/network/info` interface entry, narrowed to what the step renders. */
export interface InterfaceInfo {
  readonly name: string;
  readonly type: string;
  readonly ipv4: IpConfig;
  readonly ipv6: IpConfig;
}

function asIpMethod(value: unknown): IpMethod {
  return value === 'static' || value === 'disabled' ? value : 'auto';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Normalise a Supervisor `ipv4`/`ipv6` block into a core `IpConfig`. */
function parseIpFamily(raw: unknown): IpConfig {
  if (raw === null || typeof raw !== 'object') return { method: 'auto' };
  const block = raw as {
    method?: unknown;
    address?: unknown;
    gateway?: unknown;
    nameservers?: unknown;
  };
  const address = asStringArray(block.address);
  const nameservers = asStringArray(block.nameservers);
  const gateway =
    typeof block.gateway === 'string' && block.gateway !== '' ? block.gateway : undefined;
  return {
    method: asIpMethod(block.method),
    ...(address.length > 0 ? { address } : {}),
    ...(gateway !== undefined ? { gateway } : {}),
    ...(nameservers.length > 0 ? { nameservers } : {}),
  };
}

/**
 * Parse the `/network/info` payload
 * (`{ data: { interfaces: [{ interface, type, ipv4, ipv6 }] } }`) into the
 * interfaces the step renders. Each interface always carries an `ipv4` +
 * `ipv6` (defaulting to `{ method: 'auto' }`) so the form has a value to
 * seed every panel.
 */
export function parseInterfaces(json: unknown): InterfaceInfo[] {
  const root = json as
    | {
        data?: {
          interfaces?: readonly {
            interface?: unknown;
            type?: unknown;
            ipv4?: unknown;
            ipv6?: unknown;
          }[];
        };
      }
    | undefined;
  const result: InterfaceInfo[] = [];
  for (const iface of root?.data?.interfaces ?? []) {
    if (typeof iface.interface !== 'string' || iface.interface === '') continue;
    result.push({
      name: iface.interface,
      type: typeof iface.type === 'string' ? iface.type : 'unknown',
      ipv4: parseIpFamily(iface.ipv4),
      ipv6: parseIpFamily(iface.ipv6),
    });
  }
  return result;
}

/** First wireless interface from a `/network/info` payload, or wlan0. */
export function findWirelessInterface(json: unknown): string {
  for (const iface of parseInterfaces(json)) {
    if (iface.type === 'wireless') return iface.name;
  }
  return DEFAULT_WIRELESS_INTERFACE;
}

/**
 * Normalise the Supervisor accesspoints response
 * (`{ data: { accesspoints: [{ ssid, signal, ... }] } }`) into a
 * deduplicated AP list — dedup by SSID keeping the strongest signal, then
 * sort strongest-first.
 */
export function parseAccessPoints(json: unknown): AccessPoint[] {
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

/** Device hostname from a `/host/info` payload, if present. */
export function parseHostname(json: unknown): string | undefined {
  const root = json as { data?: { hostname?: unknown } } | undefined;
  const hostname = root?.data?.hostname;
  return typeof hostname === 'string' && hostname !== '' ? hostname : undefined;
}

/** Push the device hostname to the Supervisor host API. Throws on non-ok. */
export async function pushHostname(hostname: string): Promise<void> {
  const response = await fetch(HOST_OPTIONS_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname }),
  });
  if (!response.ok) {
    throw new Error(`Supervisor host/options responded ${String(response.status)}`);
  }
}

/** A Supervisor `ipv4`/`ipv6` update block (only meaningful keys included). */
interface SupervisorIpBlock {
  readonly method: IpMethod;
  readonly address?: string[];
  readonly gateway?: string;
  readonly nameservers?: string[];
}

/** Map a collected `IpConfig` to the Supervisor update wire shape. */
export function toSupervisorIpBlock(config: IpConfig): SupervisorIpBlock {
  if (config.method !== 'static') return { method: config.method };
  return {
    method: 'static',
    ...(config.address !== undefined && config.address.length > 0
      ? { address: config.address }
      : {}),
    ...(config.gateway !== undefined ? { gateway: config.gateway } : {}),
    ...(config.nameservers !== undefined && config.nameservers.length > 0
      ? { nameservers: config.nameservers }
      : {}),
  };
}

/**
 * POST an interface update — IP config and/or Wi-Fi credentials. The
 * Supervisor accepts `ipv4`/`ipv6`/`wifi` in one call, so the terminal
 * commit can fold the wireless interface's IP config into the same
 * request that joins the home network. Throws on non-ok.
 */
export async function pushInterfaceUpdate(
  iface: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(interfaceUpdateUrl(iface), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Supervisor interface update responded ${String(response.status)}`);
  }
}
