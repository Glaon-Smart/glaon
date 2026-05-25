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

import type { Config } from '../config';
import type { Logger } from '../observability/logger';

interface HassioNetworkRouterDeps {
  readonly config: Config;
  /** Injectable for tests — defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly logger?: Logger;
}

const MOCK_NETWORK_INFO = {
  data: {
    interfaces: [
      {
        accesspoints: [
          { ssid: 'GlaonDev-Home', auth: 'wpa-psk' },
          { ssid: 'GlaonDev-Guest', auth: 'none' },
          { ssid: 'GlaonDev-Office', auth: 'wpa-psk' },
        ],
      },
    ],
  },
};

export function createHassioNetworkRouter(deps: HassioNetworkRouterDeps): Hono {
  const router = new Hono();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { supervisorUrl, supervisorToken, supervisorMock } = deps.config;

  router.get('/network/info', async (c) => {
    if (supervisorMock) {
      return c.json(MOCK_NETWORK_INFO);
    }
    if (supervisorUrl === undefined || supervisorToken === undefined) {
      return c.json(
        {
          error: 'supervisor-not-configured',
          hint: 'Set HA_SUPERVISOR_URL + HA_SUPERVISOR_TOKEN, or HA_SUPERVISOR_MOCK=true for a canned payload. See docs/dev-supervisor.md.',
        },
        503,
      );
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

  router.post('/network/:iface/update', async (c) => {
    const iface = c.req.param('iface');
    const body: unknown = await c.req.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return c.json({ error: 'invalid-body' }, 400);
    }
    if (supervisorMock) {
      return c.json({ result: 'ok', mocked: true });
    }
    if (supervisorUrl === undefined || supervisorToken === undefined) {
      return c.json(
        {
          error: 'supervisor-not-configured',
          hint: 'Set HA_SUPERVISOR_URL + HA_SUPERVISOR_TOKEN, or HA_SUPERVISOR_MOCK=true for a canned payload. See docs/dev-supervisor.md.',
        },
        503,
      );
    }
    try {
      const upstream = await fetchImpl(
        `${trim(supervisorUrl)}/network/${encodeURIComponent(iface)}/update`,
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

  return router;
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
