// Layout step device I/O (#652). The per-step save (`POST /api/setup/
// ha-layout`) reconciles the device's HA floor + area registries to the
// editor's current layout — idempotent, so a back-navigation re-save
// doesn't duplicate floors/rooms. Mirrors the home-overview save's
// outcome mapping; raw `fetch` per the apps/web idiom.

import { SetupSeedResponseSchema, type HaLayoutResponse } from '@glaon/core/api-client';
import type { Layout } from '@glaon/core/config';

const HA_LAYOUT_URL = '/api/setup/ha-layout';
const SETUP_SEED_URL = '/api/setup';

/**
 * Outcome of reading the Layout seed from the unified `GET /api/setup`
 * (#678). `ok` separates "nothing to seed" (a `null` layout section, or a
 * 503 in HA-less / backend-down dev) — which the step handles silently —
 * from a real fetch failure that should surface a Toast.
 */
// Not exported: only `fetchLayoutSeed` (this module) references it, and
// the step consumes the result structurally (memory: knip blocks PRs on
// exports without an external consumer).
type LayoutSeedResult =
  | { readonly ok: true; readonly layout: HaLayoutResponse | null }
  | { readonly ok: false };

/**
 * Read the unified device seed and return its Layout section (#678 phase
 * 2b). A `null` section (HA Core unconfigured/unreachable) and a 503
 * (apps/api down, per the dev proxy #674) both resolve to
 * `{ ok: true, layout: null }` — expected in dev, seed silently skipped.
 * A thrown request or any other non-OK is `{ ok: false }` so the step can
 * surface a load-failed Toast.
 */
export async function fetchLayoutSeed(): Promise<LayoutSeedResult> {
  let response: Response;
  try {
    response = await fetch(SETUP_SEED_URL, { credentials: 'include' });
  } catch {
    return { ok: false };
  }
  if (response.status === 503) return { ok: true, layout: null };
  if (!response.ok) return { ok: false };
  const parsed = SetupSeedResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { ok: false };
  return { ok: true, layout: parsed.data.layout };
}

/**
 * Outcome of reconciling the layout to the device.
 *   - `ok`       the reconcile landed (all steps succeeded).
 *   - `skipped`  no HA Core configured (503) — expected in HA-less dev.
 *   - `error`    couldn't reach apps/api / HA, or a step failed.
 * Only `error` blocks advancement + surfaces a Toast.
 */
type SaveLayoutOutcome = 'ok' | 'skipped' | 'error';

/**
 * POST the editor's layout for reconcile. The body carries floor/room
 * `id`s (HA registry ids for seeded entities, client UUIDs for new ones)
 * so the server matches by id; room `type` is dropped server-side.
 */
export async function saveLayout(layout: Layout): Promise<SaveLayoutOutcome> {
  const body = {
    floors: layout.floors.map((floor) => ({
      id: floor.id,
      name: floor.name,
      rooms: floor.rooms.map((room) => ({ id: room.id, name: room.name })),
    })),
  };

  let response: Response;
  try {
    response = await fetch(HA_LAYOUT_URL, {
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
