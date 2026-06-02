// HA Supervisor network-proxy route (#598). The setup wizard's
// apply step (#597) hits `/api/hassio/network/info` for enumeration
// and `/api/hassio/network/wlan0/update` for the commit. In two
// runtime modes:
//
//   - **Add-on (production / kiosk).** The add-on's nginx proxies
//     these paths directly to HA Supervisor over Ingress. apps/api
//     is not in the path — the routes here never fire.
//
//   - **Standalone / dev.** apps/web's Vite dev server proxies
//     `/api/hassio/*` to apps/api (`/hassio/*`). This router
//     forwards to a real HA Supervisor (when `supervisorUrl` is
//     set) or returns a deterministic mock payload (when
//     `supervisorMock` is true).
//
// Three configurations to keep in mind:
//
//   - `supervisorUrl=…` + `supervisorToken=…` → live proxy. The
//     bearer token is the HA long-lived access token; we don't
//     forward the client's auth (the wizard isn't authenticated
//     yet — the user is mid-setup before any login exists).
//   - `supervisorMock=true` → return a canned 2-network payload
//     for the GET and accept any POST with a 200. Used by the
//     Playwright wizard smoke + local dev where no HA is running.
//   - Neither set → 503 with a hint pointing at the dev docs.
//
// Authentication: this route is **not gated by requireSession** on
// purpose. The wizard runs before any user account exists. CORS
// + dev-only mode (production add-on bypasses this entirely) are
// the only barriers. Don't expose this route from a production
// apps/api unless you understand the implications — see
// `docs/dev-supervisor.md` for the operational guardrails.

import { Hono } from 'hono';

import type { SetupNetwork } from '@glaon/core/api-client';

import type { Config } from '../config';
import type { Logger } from '../observability/logger';

interface HassioNetworkRouterDeps {
  readonly config: Config;
  /** Injectable for tests — defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly logger?: Logger;
}

// `/network/info` returns interfaces only — the real Supervisor does NOT
// embed access points here (#622). The wizard discovers the wireless
// interface from this list, then scans it via the accesspoints endpoint.
//
// Each interface carries `ipv4`/`ipv6` blocks matching the Supervisor
// shape (`{ method, address, gateway, nameservers, ready }`) so the
// Network step (#629) has real config to render in mock / HA-less dev.
// `end0` is a static ethernet, `wlan0` an auto/DHCP wireless — two shapes
// to exercise the UI's static vs. DHCP branches.
const MOCK_NETWORK_INFO = {
  data: {
    interfaces: [
      {
        interface: 'wlan0',
        type: 'wireless',
        enabled: true,
        connected: false,
        primary: false,
        ipv4: { method: 'auto', address: [], gateway: null, nameservers: [], ready: false },
        ipv6: { method: 'auto', address: [], gateway: null, nameservers: [], ready: false },
      },
      {
        interface: 'end0',
        type: 'ethernet',
        enabled: true,
        connected: true,
        primary: true,
        ipv4: {
          method: 'static',
          address: ['192.168.1.50/24'],
          gateway: '192.168.1.1',
          nameservers: ['192.168.1.1', '1.1.1.1'],
          ready: true,
        },
        ipv6: {
          method: 'auto',
          address: ['fe80::5c7d:aeff:fec1:7ff8/64'],
          gateway: null,
          nameservers: [],
          ready: true,
        },
      },
    ],
  },
};

// `/host/info` — device host metadata. The wizard's Network step (#629)
// seeds its hostname field from `data.hostname`.
const MOCK_HOST_INFO = {
  data: {
    hostname: 'glaon',
    operating_system: 'Home Assistant OS 12.0',
    kernel: '6.6.0',
    chassis: 'embedded',
  },
};

// `/network/interface/{iface}/accesspoints` — the real scan results.
// Shape mirrors HA Supervisor: { mode, ssid, mac, frequency, signal } and
// crucially NO `auth`/security field (#622).
const MOCK_ACCESSPOINTS = {
  data: {
    accesspoints: [
      {
        mode: 'infrastructure',
        ssid: 'GlaonDev-Home',
        mac: '00:11:22:33:44:01',
        frequency: 2412,
        signal: 72,
      },
      {
        mode: 'infrastructure',
        ssid: 'GlaonDev-Guest',
        mac: '00:11:22:33:44:02',
        frequency: 5180,
        signal: 58,
      },
      {
        mode: 'infrastructure',
        ssid: 'GlaonDev-Office',
        mac: '00:11:22:33:44:03',
        frequency: 2437,
        signal: 41,
      },
    ],
  },
};

const NOT_CONFIGURED_BODY = {
  error: 'supervisor-not-configured',
  hint: 'Set HA_SUPERVISOR_URL + HA_SUPERVISOR_TOKEN, or HA_SUPERVISOR_MOCK=true for a canned payload. See docs/dev-supervisor.md.',
} as const;

export function createHassioNetworkRouter(deps: HassioNetworkRouterDeps): Hono {
  const router = new Hono();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { supervisorUrl, supervisorToken, supervisorMock } = deps.config;

  router.get('/network/info', async (c) => {
    if (supervisorMock) {
      return c.json(MOCK_NETWORK_INFO);
    }
    if (supervisorUrl === undefined || supervisorToken === undefined) {
      return c.json(NOT_CONFIGURED_BODY, 503);
    }
    try {
      const upstream = await fetchImpl(`${trim(supervisorUrl)}/network/info`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${supervisorToken}` },
      });
      const text = await upstream.text();
      deps.logger?.info({ event: 'hassio-network.proxy.get', status: upstream.status });
      return passThroughResponse(text, upstream);
    } catch (err) {
      deps.logger?.error({
        event: 'hassio-network.proxy.get.failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
      return c.json({ error: 'supervisor-unreachable' }, 502);
    }
  });

  // Wi-Fi scan results for a wireless interface (#622). Separate from
  // /network/info — the Supervisor only exposes access points here.
  router.get('/network/interface/:iface/accesspoints', async (c) => {
    const iface = c.req.param('iface');
    if (supervisorMock) {
      return c.json(MOCK_ACCESSPOINTS);
    }
    if (supervisorUrl === undefined || supervisorToken === undefined) {
      return c.json(NOT_CONFIGURED_BODY, 503);
    }
    try {
      const upstream = await fetchImpl(
        `${trim(supervisorUrl)}/network/interface/${encodeURIComponent(iface)}/accesspoints`,
        { method: 'GET', headers: { Authorization: `Bearer ${supervisorToken}` } },
      );
      const text = await upstream.text();
      deps.logger?.info({
        event: 'hassio-network.proxy.accesspoints',
        iface,
        status: upstream.status,
      });
      return passThroughResponse(text, upstream);
    } catch (err) {
      deps.logger?.error({
        event: 'hassio-network.proxy.accesspoints.failed',
        iface,
        message: err instanceof Error ? err.message : 'unknown',
      });
      return c.json({ error: 'supervisor-unreachable' }, 502);
    }
  });

  // Commit a Wi-Fi connection. Canonical Supervisor path carries the
  // `/interface/` segment (#622) — the earlier `/network/:iface/update`
  // form 404s against a real Supervisor.
  router.post('/network/interface/:iface/update', async (c) => {
    const iface = c.req.param('iface');
    const body: unknown = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ error: 'invalid-body' }, 400);
    }
    if (supervisorMock) {
      return c.json({ result: 'ok', mocked: true });
    }
    if (supervisorUrl === undefined || supervisorToken === undefined) {
      return c.json(NOT_CONFIGURED_BODY, 503);
    }
    try {
      const upstream = await fetchImpl(
        `${trim(supervisorUrl)}/network/interface/${encodeURIComponent(iface)}/update`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supervisorToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
      const text = await upstream.text();
      // Redact the PSK before logging the body.
      const redacted = redactWifiBody(body);
      deps.logger?.info({
        event: 'hassio-network.proxy.post',
        iface,
        status: upstream.status,
        body: redacted,
      });
      return passThroughResponse(text, upstream);
    } catch (err) {
      deps.logger?.error({
        event: 'hassio-network.proxy.post.failed',
        iface,
        message: err instanceof Error ? err.message : 'unknown',
      });
      return c.json({ error: 'supervisor-unreachable' }, 502);
    }
  });

  // Host metadata — the wizard's Network step (#629) seeds its hostname
  // field from `data.hostname`. Maps to the Supervisor `/host/info`.
  router.get('/host/info', async (c) => {
    if (supervisorMock) {
      return c.json(MOCK_HOST_INFO);
    }
    if (supervisorUrl === undefined || supervisorToken === undefined) {
      return c.json(NOT_CONFIGURED_BODY, 503);
    }
    try {
      const upstream = await fetchImpl(`${trim(supervisorUrl)}/host/info`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${supervisorToken}` },
      });
      const text = await upstream.text();
      deps.logger?.info({ event: 'hassio-network.proxy.host.get', status: upstream.status });
      return passThroughResponse(text, upstream);
    } catch (err) {
      deps.logger?.error({
        event: 'hassio-network.proxy.host.get.failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
      return c.json({ error: 'supervisor-unreachable' }, 502);
    }
  });

  // Set the device hostname. Maps to the Supervisor `/host/options`.
  // `hostname`, when present, must be an RFC 1123 label — rejected with
  // 400 before touching the Supervisor (the host-side validator also
  // enforces this, but a clear 400 beats a cryptic upstream 4xx).
  router.post('/host/options', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ error: 'invalid-body' }, 400);
    }
    const { hostname } = body as { hostname?: unknown };
    if (hostname !== undefined && (typeof hostname !== 'string' || !isValidHostname(hostname))) {
      return c.json({ error: 'invalid-hostname' }, 400);
    }
    if (supervisorMock) {
      return c.json({ result: 'ok', mocked: true });
    }
    if (supervisorUrl === undefined || supervisorToken === undefined) {
      return c.json(NOT_CONFIGURED_BODY, 503);
    }
    try {
      const upstream = await fetchImpl(`${trim(supervisorUrl)}/host/options`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supervisorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await upstream.text();
      deps.logger?.info({
        event: 'hassio-network.proxy.host.post',
        status: upstream.status,
        hostname,
      });
      return passThroughResponse(text, upstream);
    } catch (err) {
      deps.logger?.error({
        event: 'hassio-network.proxy.host.post.failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
      return c.json({ error: 'supervisor-unreachable' }, 502);
    }
  });

  return router;
}

// RFC 1123 hostname label: 1–63 chars of letters, digits, and hyphens,
// no leading/trailing hyphen. Mirrors @glaon/core's NetworkConfigSchema
// (kept inline so this proxy carries no @glaon/core dependency).
const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function isValidHostname(value: string): boolean {
  return HOSTNAME_RE.test(value);
}

// Mirror the upstream supervisor response back to the caller. Returning
// a raw `Response` from a Hono handler short-circuits Hono's status-
// literal narrowing — important because HA Supervisor can return any
// numeric status and `c.body` / `c.json` only accept Hono's curated
// literal set.
function passThroughResponse(text: string, upstream: Response): Response {
  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': contentType },
  });
}

/** Probe used by `/healthz/supervisor` (see server.ts). */
export async function probeSupervisor(
  config: Config,
  fetchImpl: typeof fetch = fetch,
  logger?: Logger,
): Promise<{
  readonly ok: boolean;
  readonly mode: 'mock' | 'live' | 'unconfigured';
  readonly status?: number;
  readonly reason?: string;
}> {
  if (config.supervisorMock) {
    return { ok: true, mode: 'mock' };
  }
  if (config.supervisorUrl === undefined || config.supervisorToken === undefined) {
    return { ok: false, mode: 'unconfigured' };
  }
  const url = `${trim(config.supervisorUrl)}/network/info`;
  try {
    const upstream = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.supervisorToken}` },
    });
    if (!upstream.ok) {
      logger?.warn({
        event: 'hassio-network.probe.non-ok',
        url,
        status: upstream.status,
      });
      return { ok: false, mode: 'live', status: upstream.status };
    }
    return { ok: true, mode: 'live', status: upstream.status };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    logger?.error({ event: 'hassio-network.probe.threw', url, reason });
    return { ok: false, mode: 'live', reason };
  }
}

function trim(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Read the Network section of the unified wizard seed (#678): the
 * Supervisor `/host/info` hostname + `/network/info` interfaces. Mirrors
 * this router's source resolution — mock → canned payload; configured →
 * Supervisor REST; unconfigured → `null`. Per-section graceful: any
 * failure (unconfigured, unreachable, malformed) resolves to `null` so the
 * aggregate `GET /setup` still returns the other sections. Live Wi-Fi
 * scanning + interface writes stay on the `/api/hassio/*` routes.
 */
export async function readNetworkSeed(deps: {
  readonly config: Config;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: Logger;
}): Promise<SetupNetwork | null> {
  const { supervisorUrl, supervisorToken, supervisorMock } = deps.config;
  if (supervisorMock) {
    return {
      hostname: MOCK_HOST_INFO.data.hostname,
      interfaces: MOCK_NETWORK_INFO.data.interfaces,
    };
  }
  if (supervisorUrl === undefined || supervisorToken === undefined) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = trim(supervisorUrl);
  const headers = { Authorization: `Bearer ${supervisorToken}` };
  try {
    const [hostRes, netRes] = await Promise.all([
      fetchImpl(`${base}/host/info`, { method: 'GET', headers }),
      fetchImpl(`${base}/network/info`, { method: 'GET', headers }),
    ]);
    const seed: SetupNetwork = {};
    if (hostRes.ok) {
      const host = (await hostRes.json().catch(() => null)) as {
        data?: { hostname?: unknown };
      } | null;
      if (typeof host?.data?.hostname === 'string') seed.hostname = host.data.hostname;
    }
    if (netRes.ok) {
      const net = (await netRes.json().catch(() => null)) as {
        data?: { interfaces?: unknown };
      } | null;
      if (Array.isArray(net?.data?.interfaces)) seed.interfaces = net.data.interfaces;
    }
    return seed;
  } catch (err) {
    deps.logger?.warn({
      event: 'setup.network-seed.failed',
      message: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

function redactWifiBody(body: unknown): unknown {
  if (body === null || typeof body !== 'object') return body;
  const candidate = body as { wifi?: { psk?: unknown } };
  if (
    candidate.wifi !== undefined &&
    typeof candidate.wifi === 'object' &&
    'psk' in candidate.wifi &&
    candidate.wifi.psk !== undefined
  ) {
    return { ...candidate, wifi: { ...candidate.wifi, psk: '[redacted]' } };
  }
  return body;
}
