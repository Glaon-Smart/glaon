// Hono app factory per ADR 0025. The factory takes its dependencies as
// arguments rather than reaching into globals, so unit tests can hand in
// a stub Mongo + config without spinning up a real driver.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from 'mongodb';

import { decodeSecret } from './auth/jwt';
import { MongoRevocationStore, type RevocationStore } from './auth/revocation';
import type { Config } from './config';
import { pingDb } from './db';
import { observabilityMiddleware } from './middleware/observability';
import { createLogger, type Logger } from './observability/logger';
import { Metrics } from './observability/metrics';
import { createAuthRouter } from './routes/auth';
import { createHassioNetworkRouter, probeSupervisor } from './routes/hassio-network';
import { createLayoutsRouter } from './routes/layouts';
import { createMeRouter } from './routes/me';
import { createSetupRouter } from './routes/setup';

export interface ServerDeps {
  readonly db: Db;
  readonly config: Config;
  readonly revocations?: RevocationStore;
  readonly fetchImpl?: typeof fetch;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
}

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();
  const secret = decodeSecret(deps.config.sessionJwtSecret);
  const revocations = deps.revocations ?? new MongoRevocationStore(deps.db);
  const logger = deps.logger ?? createLogger({ level: deps.config.logLevel });
  const metrics = deps.metrics ?? new Metrics();

  app.use('*', observabilityMiddleware({ logger, metrics }));

  // CORS allow-list (#525). `config.webOrigins` drives both the
  // preflight `Access-Control-Allow-Origin` response and the
  // Set-Cookie logic in routes/auth.ts — both consume the same env-
  // configured allow-list, so a developer can't accidentally enable
  // one path without the other. `credentials: true` is required so
  // the session-cookie flow keeps working for cookie-mode web
  // clients; the allow-list (not `*`) makes that safe.
  //
  // Empty `webOrigins` means no cross-origin client is allowed; the
  // preflight response carries no `Access-Control-Allow-Origin` and
  // the browser drops the call. Production deploys MUST set the env
  // var; dev defaults live in `apps/api/.env.example`.
  app.use(
    '*',
    cors({
      origin: (incoming) => (deps.config.webOrigins.includes(incoming) ? incoming : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  app.route(
    '/auth',
    createAuthRouter({
      secret,
      revocations,
      webOrigins: deps.config.webOrigins,
      sessionTtlSeconds: deps.config.sessionTtlSeconds,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    }),
  );

  app.route('/layouts', createLayoutsRouter({ db: deps.db, secret, revocations }));

  app.route('/me', createMeRouter({ db: deps.db, secret, revocations }));

  // HA Supervisor network proxy (#598). Used by the setup wizard's
  // apply step in standalone / dev runtimes; the production add-on
  // bypasses this entirely via its own nginx → supervisor proxy.
  // See `docs/dev-supervisor.md` + the route header for the
  // operational guardrails (unauthenticated by design, but CORS-
  // gated and dev-mode).
  app.route(
    '/hassio',
    createHassioNetworkRouter({
      config: deps.config,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      logger,
    }),
  );

  // Setup-wizard → HA config push (#617). The wizard's apply step POSTs
  // the collected home settings; we translate them into HA Core
  // WebSocket commands. Unauthenticated by design (wizard is pre-login),
  // same posture as /hassio. Dev-first — production onboarding routes
  // through the relay / add-on, not this route (ADR 0029).
  app.route(
    '/setup',
    createSetupRouter({
      config: deps.config,
      logger,
    }),
  );

  // Liveness probe with Mongo ping. Returns 200 when the driver
  // command succeeds, 503 otherwise so a load balancer can drop the
  // instance from rotation. The metrics gauge is updated on every
  // call so /metrics surfaces the latest observation.
  app.get('/healthz', async (c) => {
    const result = await pingDb(deps.db);
    metrics.setMongoPing(result.latencyMs);
    return c.json(
      {
        status: result.ok ? 'ok' : 'degraded',
        mongo: result,
        version: deps.config.buildInfo.version,
        commit: deps.config.buildInfo.commit,
      },
      result.ok ? 200 : 503,
    );
  });

  // Supervisor reachability probe (#598). Returns:
  //   - 200 + { mode: 'mock' }       when HA_SUPERVISOR_MOCK is on.
  //   - 200 + { mode: 'live' }       when the real supervisor proxy
  //                                  answers /network/info OK.
  //   - 503 + { mode: 'live' }       supervisor configured but not
  //                                  reachable.
  //   - 503 + { mode: 'unconfigured' } neither mock nor live config
  //                                  is set (the proxy will respond
  //                                  503 to wizard calls too).
  app.get('/healthz/supervisor', async (c) => {
    const probe = await probeSupervisor(deps.config, deps.fetchImpl ?? fetch, logger);
    const body: Record<string, unknown> = {
      status: probe.ok ? 'ok' : 'unavailable',
      mode: probe.mode,
    };
    if (probe.status !== undefined) body.upstreamStatus = probe.status;
    if (probe.reason !== undefined) body.reason = probe.reason;
    return c.json(body, probe.ok ? 200 : 503);
  });

  // Build info — useful for the deploy pipeline + manual debugging.
  app.get('/version', (c) => {
    return c.json({
      version: deps.config.buildInfo.version,
      commit: deps.config.buildInfo.commit,
      builtAt: deps.config.buildInfo.builtAt,
    });
  });

  // Prometheus-style text exposition (#423). Minimal subset — process
  // uptime, request counts (method/route/status), latest mongo ping.
  app.get('/metrics', (c) => {
    return c.text(metrics.render(), 200, { 'Content-Type': 'text/plain; version=0.0.4' });
  });

  return app;
}
