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

import { SetupSeedResponseSchema, type SetupHomeOverview } from '@glaon/core/api-client';
import { HA_LANGUAGES } from '@glaon/core/i18n';

import type { Config } from '../config';
import {
  applyHaSetup,
  createHaCoreClientFactory,
  HaCoreUnreachableError,
  readHaConfig,
  readHaLayout,
  readHomeZoneRadius,
  reconcileHaLayout,
  type HaSetupClient,
} from '../ha/ha-setup-service';
import { readNetworkSeed } from './hassio-network';
import type { Logger } from '../observability/logger';
import { ApplyHaRequestSchema, ReconcileLayoutRequestSchema } from '../schemas';

interface SetupRouterDeps {
  readonly config: Config;
  /** Injectable for tests — defaults to a real HA Core WS client. */
  readonly clientFactory?: () => HaSetupClient;
  /** Injectable for tests — the Supervisor `fetch` for the network seed
   *  (#678). Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly logger?: Logger;
}

export function createSetupRouter(deps: SetupRouterDeps): Hono {
  const router = new Hono();
  const { haCoreUrl, haCoreToken } = deps.config;

  // A test-injected factory bypasses the env requirement; otherwise we
  // need the URL + token to build the real client. `undefined` → the
  // caller returns 503 ha-core-not-configured.
  const resolveFactory = (): (() => HaSetupClient) | undefined =>
    deps.clientFactory ??
    (haCoreUrl !== undefined && haCoreToken !== undefined
      ? createHaCoreClientFactory(haCoreUrl, haCoreToken)
      : undefined);

  const notConfigured = {
    error: 'ha-core-not-configured',
    hint: 'Set HA_CORE_URL + HA_CORE_TOKEN (a long-lived access token). See docs/dev-supervisor.md.',
  } as const;

  const withLogger = (factory: () => HaSetupClient) =>
    deps.logger !== undefined
      ? { clientFactory: factory, logger: deps.logger }
      : { clientFactory: factory };

  // Unified wizard seed (#678): one read for the whole wizard, grouped by
  // step. Each section is independently nullable — HA Core unreachable/
  // unconfigured → `homeOverview`/`layout` null; Supervisor unreachable/
  // unconfigured → `network` null. Always 200 (an apps/api outage is
  // surfaced upstream by the dev proxy's 503, #674), so the wizard seeds
  // whatever is present and degrades the rest. Sections read in parallel.
  //
  // The legacy `/ha-config` + `/ha-layout` GET routes below stay as
  // deprecated aliases until the frontend migrates to this endpoint
  // (#678 phase 2).
  router.get('/', async (c) => {
    const factory = resolveFactory();

    const homeOverviewP: Promise<SetupHomeOverview | null> = (async () => {
      if (factory === undefined) return null;
      try {
        const [config, radius] = await Promise.all([
          readHaConfig(withLogger(factory)),
          readHomeZoneRadius(withLogger(factory)),
        ]);
        return radius !== undefined ? { ...config, radius } : { ...config };
      } catch (err) {
        deps.logger?.warn({
          event: 'setup.seed.home-overview.failed',
          message: err instanceof Error ? err.message : 'unknown',
        });
        return null;
      }
    })();

    const layoutP = (async () => {
      if (factory === undefined) return null;
      try {
        return await readHaLayout(withLogger(factory));
      } catch (err) {
        deps.logger?.warn({
          event: 'setup.seed.layout.failed',
          message: err instanceof Error ? err.message : 'unknown',
        });
        return null;
      }
    })();

    const networkP = readNetworkSeed({
      config: deps.config,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    });

    const [homeOverview, layout, network] = await Promise.all([homeOverviewP, layoutP, networkP]);

    // Languages offered by the picker (#683): the HA-supported set with the
    // device's current language guaranteed present (deduped, device-first so
    // an unlisted-but-active language still surfaces). Always available — the
    // static set stands in even when HA Core is unconfigured.
    const deviceLanguage = homeOverview?.language;
    const languages = [
      ...(deviceLanguage !== undefined ? [deviceLanguage] : []),
      ...HA_LANGUAGES.filter((code) => code !== deviceLanguage),
    ];

    // Validate the assembled seed against the published contract before
    // returning — strips any stray keys + guarantees the nested shape.
    return c.json(SetupSeedResponseSchema.parse({ homeOverview, layout, network, languages }), 200);
  });

  // The per-step GET seeds (`/ha-config` #646, `/ha-layout` #638) were
  // folded into the unified `GET /` aggregator above (#678) and removed
  // once the frontend migrated to it (Home Overview, Layout). The POST
  // reconcile (`/ha-layout`) + commit (`/apply-ha`) below are unchanged.

  // Per-step Layout save (#652): reconcile the device's floor + area
  // registries to the wizard's desired layout. Idempotent — safe to
  // re-POST on back-navigation. Same auth posture + config-gating.
  router.post('/ha-layout', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = ReconcileLayoutRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'invalid-body' }, 400);

    const factory = resolveFactory();
    if (factory === undefined) return c.json(notConfigured, 503);
    try {
      const result = await reconcileHaLayout(parsed.data, {
        clientFactory: factory,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      });
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof HaCoreUnreachableError) {
        deps.logger?.error({ event: 'setup.ha-layout-save.unreachable', message: err.message });
        return c.json({ error: 'ha-unreachable' }, 502);
      }
      deps.logger?.error({
        event: 'setup.ha-layout-save.failed',
        message: err instanceof Error ? err.message : 'unknown',
      });
      return c.json({ error: 'internal' }, 500);
    }
  });

  router.post('/apply-ha', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = ApplyHaRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid-body' }, 400);
    }

    const factory = resolveFactory();
    if (factory === undefined) {
      return c.json(notConfigured, 503);
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
