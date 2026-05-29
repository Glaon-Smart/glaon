// Home Overview device I/O (#646). The wizard's per-step model reads the
// step's parameters from the device on mount and writes them back on
// "Next" before advancing — so the data lives on the device, not in
// localStorage. Following the apps/web idiom (raw `fetch` + the feature
// layer owning the call; see network-api.ts), not TanStack Query.
//
// Both calls hit apps/api, which proxies to HA Core over WebSocket. A 503
// (`ha-core-not-configured`) means this environment has no HA Core wired
// (HA-less dev) — reads degrade to "no seed" and saves degrade to a
// no-op success so the wizard still walks in standalone dev.

import { HaConfigResponseSchema, type HaConfigResponse } from '@glaon/core/api-client';

const HA_CONFIG_URL = '/api/setup/ha-config';
const HA_APPLY_SETTINGS = '/api/setup/apply-ha';

/**
 * Read the device's current HA Core config to seed the Home Overview
 * fields. Returns `null` when there is nothing to seed — no HA Core
 * configured (503), unreachable, or a malformed response — so the caller
 * just starts with blank/auto-detect defaults.
 */
export async function fetchHaConfig(): Promise<HaConfigResponse | null> {
  let response: Response;
  try {
    response = await fetch(HA_CONFIG_URL, { credentials: 'include' });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  // Validate the (camelCase) seed apps/api returns; pass the parsed JSON
  // straight into Zod rather than binding it to an `any` local.
  const parsed = HaConfigResponseSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/**
 * Outcome of saving the Home Overview slice to HA Core.
 *   - `ok`       the save landed (or there was nothing to save).
 *   - `skipped`  no HA Core configured (503) — expected in HA-less dev.
 *   - `error`    couldn't reach apps/api / HA, or HA rejected a field.
 * `skipped` is a success from the wizard's perspective (it advances); only
 * `error` blocks advancement and surfaces a Toast.
 */
type SaveHomeSettingsOutcome = 'ok' | 'skipped' | 'error';

// Fields carry an explicit `| undefined` so callers can pass the step's
// raw state (where a field may be `undefined`) under
// `exactOptionalPropertyTypes`; `saveHomeSettings` guards each one.
/** The Home Overview fields that map onto HA Core config (`apply-ha`). */
interface HomeSettingsSlice {
  readonly latitude?: number | undefined;
  readonly longitude?: number | undefined;
  readonly unitSystem?: 'metric' | 'imperial' | undefined;
  readonly timezone?: string | undefined;
  readonly country?: string | undefined;
  readonly locale?: string | undefined;
}

/**
 * Push the Home Overview slice to HA Core via apps/api's `apply-ha`
 * (idempotent `config/core/update`). Mirrors the apply step's outcome
 * mapping so the per-step save and the terminal commit treat HA the same.
 */
export async function saveHomeSettings(slice: HomeSettingsSlice): Promise<SaveHomeSettingsOutcome> {
  const body: Record<string, unknown> = {};
  if (slice.latitude !== undefined) body.latitude = slice.latitude;
  if (slice.longitude !== undefined) body.longitude = slice.longitude;
  if (slice.unitSystem !== undefined) body.unitSystem = slice.unitSystem;
  if (slice.timezone !== undefined && slice.timezone !== '') body.timezone = slice.timezone;
  if (slice.country !== undefined && slice.country !== '') body.country = slice.country;
  if (slice.locale !== undefined && slice.locale !== '') body.locale = slice.locale;

  // Nothing to persist → no-op success.
  if (Object.keys(body).length === 0) return 'ok';

  let response: Response;
  try {
    response = await fetch(HA_APPLY_SETTINGS, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return 'error';
  }
  if (response.status === 503) return 'skipped';
  if (!response.ok) return 'error';
  const json = (await response.json().catch(() => null)) as { ok?: boolean } | null;
  if (json === null) return 'error';
  return json.ok === true ? 'ok' : 'error';
}
