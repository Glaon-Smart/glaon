// Setup-wizard → HA config route (#617). The wizard's apply step POSTs
// the collected home settings here; we translate them into HA Core
// WebSocket commands (see ha/ha-setup-service.ts) and report per-step
// results.
//
// Authentication: like the hassio-network proxy, this route is **not**
// gated by `requireSession` — the setup wizard runs before any user
// account exists. CORS + the dev-only nature of standalone mode are the
// barriers. Production onboarding does not hit this route (ADR 0029).
//
// Responses:
//   - 200 { ok, steps }   commands attempted; `ok` is true only if all
//                         succeeded. Partial failure is still 200 — the
//                         per-step array tells the client what landed.
//   - 400 invalid-body    Zod rejected the payload.
//   - 502 ha-unreachable  couldn't open / auth the WS to HA Core.
//   - 503 not-configured  HA_CORE_URL / HA_CORE_TOKEN unset.

import { Hono } from 'hono';

import type { Config } from '../config';
import {
  applyHaSetup,
  createHaCoreClientFactory,
  HaCoreUnreachableError,
  type HaSetupClient,
} from '../ha/ha-setup-service';
import type { Logger } from '../observability/logger';
import { ApplyHaRequestSchema } from '../schemas';

interface SetupRouterDeps {
  readonly config: Config;
  /** Injectable for tests — defaults to a real HA Core WS client. */
  readonly clientFactory?: () => HaSetupClient;
  readonly logger?: Logger;
}

export function createSetupRouter(deps: SetupRouterDeps): Hono {
  const router = new Hono();
  const { haCoreUrl, haCoreToken } = deps.config;

  router.post('/apply-ha', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = ApplyHaRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid-body' }, 400);
    }

    // A test-injected factory bypasses the env requirement; otherwise we
    // need the URL + token to build the real client.
    const factory =
      deps.clientFactory ??
      (haCoreUrl !== undefined && haCoreToken !== undefined
        ? createHaCoreClientFactory(haCoreUrl, haCoreToken)
        : undefined);

    if (factory === undefined) {
      return c.json(
        {
          error: 'ha-core-not-configured',
          hint: 'Set HA_CORE_URL + HA_CORE_TOKEN (a long-lived access token). See docs/dev-supervisor.md.',
        },
        503,
      );
    }

    try {
      const result = await applyHaSetup(parsed.data, {
        clientFactory: factory,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      });
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof HaCoreUnreachableError) {
        deps.logger?.error({ event: 'setup.apply-ha.unreachable', message: err.message });
        return c.json({ error: 'ha-unreachable' }, 502);
      }
      deps.logger?.error({
        event: 'setup.apply-ha.failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
      return c.json({ error: 'internal' }, 500);
    }
  });

  return router;
}
