// Layout step device I/O (#652). The per-step save (`POST /api/setup/
// ha-layout`) reconciles the device's HA floor + area registries to the
// editor's current layout — idempotent, so a back-navigation re-save
// doesn't duplicate floors/rooms. Mirrors the home-overview save's
// outcome mapping; raw `fetch` per the apps/web idiom.

import type { Layout } from '@glaon/core/config';

const HA_LAYOUT_URL = '/api/setup/ha-layout';

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
