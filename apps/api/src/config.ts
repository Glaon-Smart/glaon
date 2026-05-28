// Runtime configuration parsed from process.env at boot. Validation is
// strict — missing required values surface as a fatal startup error so a
// misconfigured deployment crashes loud rather than booting in a degraded
// state. Per ADR 0025 we lean on Zod across the service.

import { z } from 'zod';

const ConfigSchema = z.object({
  port: z
    .string()
    .optional()
    .default('8080')
    .transform((value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`PORT must be a valid TCP port; got "${value}"`);
      }
      return parsed;
    }),
  mongodbUri: z.string().min(1, 'MONGODB_URI is required'),
  mongodbDb: z.string().min(1).default('glaon'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  sessionJwtSecret: z
    .string()
    .min(32, 'SESSION_JWT_SECRET must be at least 32 bytes (use a 256-bit random value)'),
  sessionTtlSeconds: z.number().int().positive().default(3600),
  webOrigins: z.array(z.string().url()).default([]),
  // HA Supervisor proxy (#598). Dev mode — the wizard's apply step
  // hits `/api/hassio/network/*` on the web origin; the Vite dev
  // proxy routes those calls to apps/api which forwards them to a
  // real HA Supervisor (when `supervisorUrl` is set) or returns
  // a canned mock payload (when `supervisorMock` is true). Both
  // unset → the proxy responds 503 with a hint, the wizard's apply
  // step lands on its error retry affordance.
  //
  // Production add-on deployments bypass this route entirely — the
  // add-on's own nginx proxies the wizard's network calls directly
  // to the supervisor over Ingress. The proxy lives here so the
  // standalone / dev wizard can talk to a real HA without the
  // add-on harness.
  supervisorUrl: z.string().url().optional(),
  supervisorToken: z.string().optional(),
  supervisorMock: z.boolean().default(false),
  // HA Core WebSocket (#617). The setup wizard's apply step pushes the
  // collected home settings (location, timezone, unit-system, country,
  // language, floors/rooms) into HA via `config/core/update` +
  // `config/{floor,area}_registry/create` — all WebSocket-only commands
  // with no REST equivalent. apps/api opens a WS to HA Core with the
  // long-lived access token (which HA Core accepts, unlike the
  // Supervisor `/api/hassio/*` proxy — see #602).
  //
  // `haCoreUrl` is the HA Core HTTP base (e.g.
  // `http://homeassistant.local:8123`); the WS transport rewrites the
  // scheme. Both unset → `POST /setup/apply-ha` responds 503. This is a
  // dev-first capability (ADR 0029) — production onboarding routes
  // through the relay / add-on, not a direct apps/api → HA Core WS.
  haCoreUrl: z.string().url().optional(),
  haCoreToken: z.string().optional(),
  buildInfo: z.object({
    commit: z.string().default('unknown'),
    builtAt: z.string().default(''),
    version: z.string().default('0.0.0'),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const ttlRaw = env.SESSION_TTL_SECONDS;
  const ttl = ttlRaw === undefined ? undefined : Number.parseInt(ttlRaw, 10);
  return ConfigSchema.parse({
    port: env.PORT,
    mongodbUri: env.MONGODB_URI ?? '',
    mongodbDb: env.MONGODB_DB ?? 'glaon',
    logLevel: env.LOG_LEVEL ?? 'info',
    sessionJwtSecret: env.SESSION_JWT_SECRET ?? '',
    sessionTtlSeconds: ttl,
    webOrigins: parseOrigins(env.WEB_ORIGINS),
    // Empty-string coercion to undefined keeps the proxy's
    // "supervisor-not-configured" branch firing on a fresh
    // .env-from-example where the developer hasn't pasted the LLT
    // yet — otherwise apps/api would forward an empty Bearer to
    // HA and trigger a 401 (#602).
    supervisorUrl: env.HA_SUPERVISOR_URL === '' ? undefined : env.HA_SUPERVISOR_URL,
    supervisorToken: env.HA_SUPERVISOR_TOKEN === '' ? undefined : env.HA_SUPERVISOR_TOKEN,
    supervisorMock: parseBool(env.HA_SUPERVISOR_MOCK),
    // Empty-string → undefined, same rationale as the supervisor vars:
    // a fresh .env-from-example leaves these blank, and the route's
    // "ha-core-not-configured" 503 branch must fire rather than apps/api
    // dialing an empty WS URL with an empty token.
    haCoreUrl: env.HA_CORE_URL === '' ? undefined : env.HA_CORE_URL,
    haCoreToken: env.HA_CORE_TOKEN === '' ? undefined : env.HA_CORE_TOKEN,
    buildInfo: {
      commit: env.GLAON_API_COMMIT ?? 'unknown',
      builtAt: env.GLAON_API_BUILT_AT ?? '',
      version: env.GLAON_API_VERSION ?? '0.0.0',
    },
  });
}

function parseOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.length === 0) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return undefined;
}
