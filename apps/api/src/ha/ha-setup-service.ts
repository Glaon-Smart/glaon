// HA Core setup service (#617). Pushes the wizard's collected home
// settings into Home Assistant over the WebSocket API:
//
//   - `config/core/update`           → location / timezone / unit-system
//                                       / country / language
//   - `config/floor_registry/create` → one per wizard floor
//   - `config/area_registry/create`  → one per room, linked to its floor
//
// These are WebSocket-only commands (no REST). We reuse @glaon/core's
// `HaClient` + `DirectWsTransport` (globalThis.WebSocket — present in
// Node 22) and authenticate with the long-lived access token, which HA
// Core accepts (unlike the Supervisor `/api/hassio/*` proxy — see #602).
//
// Execution is best-effort + per-step: every command runs even when an
// earlier one fails, so the caller gets a full picture rather than a
// fail-fast that leaves HA half-configured with no record of what
// landed. A floor-create failure degrades gracefully — its rooms are
// still created, just without a `floor_id` (older HA builds with no
// floor registry).
//
// Connection failure (WS unreachable / auth rejected) is the one
// fail-loud case: it throws `HaCoreUnreachableError` so the route maps
// it to 502 rather than reporting an all-failed step list.

import {
  HaClient,
  buildHaSetupPlan,
  buildLayoutFromRegistries,
  buildLayoutReconcilePlan,
  mapHaConfigResult,
  mapHomeZoneRadius,
  type FloorRef,
  type HaAreaRegistryEntry,
  type HaConfigSeed,
  type HaFloorRegistryEntry,
  type HaLayoutResult,
  type HaSetupInput,
  type ReconcileLayoutInput,
} from '@glaon/core/ha';
import type { ApplyHaResponse, ApplyHaStepResult } from '@glaon/core/api-client';

import type { Logger } from '../observability/logger';
import { NodeWsTransport } from './node-ws-transport';

/**
 * The slice of `HaClient` the service drives. Declared narrowly so tests
 * inject a fake without a live WebSocket; the real `HaClient` is
 * structurally assignable.
 */
export interface HaSetupClient {
  connect(): Promise<void>;
  request<TResult = unknown>(frame: Parameters<HaClient['request']>[0]): Promise<TResult>;
  close(): Promise<void>;
}

export class HaCoreUnreachableError extends Error {
  constructor(cause: string) {
    super(`HA Core unreachable: ${cause}`);
    this.name = 'HaCoreUnreachableError';
  }
}

interface ApplyHaSetupDeps {
  /** Builds a fresh client per call. Production wraps DirectWsTransport. */
  readonly clientFactory: () => HaSetupClient;
  readonly logger?: Logger;
}

/**
 * Run the setup plan against HA. Resolves with per-step results
 * (`ok: true` only when every attempted step succeeded). Rejects with
 * `HaCoreUnreachableError` when the connection itself can't be
 * established — the route turns that into a 502.
 */
export async function applyHaSetup(
  input: HaSetupInput,
  deps: ApplyHaSetupDeps,
): Promise<ApplyHaResponse> {
  const plan = buildHaSetupPlan(input);
  const steps: ApplyHaStepResult[] = [];
  const client = deps.clientFactory();

  try {
    await client.connect();
  } catch (err) {
    // Couldn't even open/auth the WS — nothing landed in HA.
    throw new HaCoreUnreachableError(errMessage(err));
  }

  try {
    if (plan.coreUpdate !== null) {
      steps.push(
        await runStep('core', deps.logger, () =>
          client.request({ type: 'config/core/update', ...plan.coreUpdate }),
        ),
      );
    }

    for (const floor of plan.floors) {
      let floorId: string | undefined;
      const floorStep = await runStep(`floor:${floor.name}`, deps.logger, async () => {
        const result = await client.request<HaFloorRegistryEntry>({
          type: 'config/floor_registry/create',
          name: floor.name,
          level: floor.level,
        });
        floorId = result.floor_id;
      });
      steps.push(floorStep);

      for (const room of floor.rooms) {
        steps.push(
          await runStep(`area:${room.name}`, deps.logger, () =>
            client.request<HaAreaRegistryEntry>({
              type: 'config/area_registry/create',
              name: room.name,
              // Omit floor_id entirely on the degrade path so HA doesn't
              // reject an `undefined` link.
              ...(floorId !== undefined ? { floor_id: floorId } : {}),
            }),
          ),
        );
      }
    }
  } finally {
    // Best-effort close — we already have our results; a close error
    // shouldn't mask them.
    await client.close().catch(() => {
      /* ignore */
    });
  }

  return { ok: steps.every((step) => step.ok), steps };
}

/**
 * Read the device's existing HA floors + areas and normalize them into a
 * layout seed for the wizard's Layout step (#638). Connection failure is
 * fail-loud (`HaCoreUnreachableError` → 502); a per-command failure (e.g.
 * an older HA with no floor registry) degrades to an empty list so areas
 * still come through as unassigned rather than failing the whole read.
 */
export async function readHaLayout(deps: ReadHaLayoutDeps): Promise<HaLayoutResult> {
  const client = deps.clientFactory();

  try {
    await client.connect();
  } catch (err) {
    throw new HaCoreUnreachableError(errMessage(err));
  }

  try {
    const floors = await client
      .request<readonly HaFloorRegistryEntry[]>({ type: 'config/floor_registry/list' })
      .catch((err: unknown) => {
        deps.logger?.warn({ event: 'ha-layout.floors.failed', error: errMessage(err) });
        return [] as readonly HaFloorRegistryEntry[];
      });
    const areas = await client
      .request<readonly HaAreaRegistryEntry[]>({ type: 'config/area_registry/list' })
      .catch((err: unknown) => {
        deps.logger?.warn({ event: 'ha-layout.areas.failed', error: errMessage(err) });
        return [] as readonly HaAreaRegistryEntry[];
      });
    return buildLayoutFromRegistries(floors, areas);
  } finally {
    await client.close().catch(() => {
      /* ignore */
    });
  }
}

interface ReadHaLayoutDeps {
  readonly clientFactory: () => HaSetupClient;
  readonly logger?: Logger;
}

/**
 * Reconcile HA's floor + area registries to the wizard's desired layout
 * (#652). Reads the current registries, diffs them via the pure
 * `buildLayoutReconcilePlan`, then executes the plan idempotently:
 * create floors → create/update (rename + reparent) areas → delete areas
 * → delete floors. Created floor ids are threaded into the areas that
 * point at them. Best-effort + per-step (like `applyHaSetup`); connection
 * failure is fail-loud (`HaCoreUnreachableError` → 502).
 */
export async function reconcileHaLayout(
  desired: ReconcileLayoutInput,
  deps: ApplyHaSetupDeps,
): Promise<ApplyHaResponse> {
  const client = deps.clientFactory();
  const steps: ApplyHaStepResult[] = [];

  try {
    await client.connect();
  } catch (err) {
    throw new HaCoreUnreachableError(errMessage(err));
  }

  try {
    // Read current registries (graceful-degrade to empty on a per-list
    // failure, same as readHaLayout).
    const floors = await client
      .request<readonly HaFloorRegistryEntry[]>({ type: 'config/floor_registry/list' })
      .catch(() => [] as readonly HaFloorRegistryEntry[]);
    const areas = await client
      .request<readonly HaAreaRegistryEntry[]>({ type: 'config/area_registry/list' })
      .catch(() => [] as readonly HaAreaRegistryEntry[]);
    const existing = buildLayoutFromRegistries(floors, areas);
    const plan = buildLayoutReconcilePlan(existing, desired);

    // 1. Create floors first, capturing the returned floor_id per key.
    const keyToFloorId = new Map<string, string>();
    for (const floor of plan.floorsToCreate) {
      steps.push(
        await runStep(`floor:create:${floor.name}`, deps.logger, async () => {
          const result = await client.request<HaFloorRegistryEntry>({
            type: 'config/floor_registry/create',
            name: floor.name,
            level: floor.level,
          });
          keyToFloorId.set(floor.key, result.floor_id);
        }),
      );
    }

    const resolveFloor = (ref: FloorRef): string | null =>
      ref.kind === 'existing' ? ref.floorId : (keyToFloorId.get(ref.key) ?? null);

    // 2. Rename floors.
    for (const floor of plan.floorsToUpdate) {
      steps.push(
        await runStep(`floor:update:${floor.name}`, deps.logger, () =>
          client.request({
            type: 'config/floor_registry/update',
            floor_id: floor.floorId,
            name: floor.name,
          }),
        ),
      );
    }

    // 3. Create areas under their (possibly just-created) floor.
    for (const area of plan.areasToCreate) {
      const floorId = resolveFloor(area.floor);
      steps.push(
        await runStep(`area:create:${area.name}`, deps.logger, () =>
          client.request({
            type: 'config/area_registry/create',
            name: area.name,
            ...(floorId !== null ? { floor_id: floorId } : {}),
          }),
        ),
      );
    }

    // 4. Rename / reparent areas.
    for (const area of plan.areasToUpdate) {
      steps.push(
        await runStep(`area:update:${area.areaId}`, deps.logger, () =>
          client.request({
            type: 'config/area_registry/update',
            area_id: area.areaId,
            ...(area.name !== undefined ? { name: area.name } : {}),
            ...(area.floor !== undefined ? { floor_id: resolveFloor(area.floor) } : {}),
          }),
        ),
      );
    }

    // 5. Delete removed areas, then 6. removed floors (areas first so a
    // deleted floor never orphans an area).
    for (const areaId of plan.areaIdsToDelete) {
      steps.push(
        await runStep(`area:delete:${areaId}`, deps.logger, () =>
          client.request({ type: 'config/area_registry/delete', area_id: areaId }),
        ),
      );
    }
    for (const floorId of plan.floorIdsToDelete) {
      steps.push(
        await runStep(`floor:delete:${floorId}`, deps.logger, () =>
          client.request({ type: 'config/floor_registry/delete', floor_id: floorId }),
        ),
      );
    }
  } finally {
    await client.close().catch(() => {
      /* ignore */
    });
  }

  return { ok: steps.every((step) => step.ok), steps };
}

/**
 * Read the device's current HA Core config (location, unit system, time
 * zone, currency, country, language) and normalize it into the wizard's
 * Home Overview seed (#646). Connection failure is fail-loud
 * (`HaCoreUnreachableError` → 502); a malformed/empty result degrades to
 * an empty seed (`{}`) so the wizard just starts blank rather than failing.
 */
export async function readHaConfig(deps: ReadHaConfigDeps): Promise<HaConfigSeed> {
  const client = deps.clientFactory();

  try {
    await client.connect();
  } catch (err) {
    throw new HaCoreUnreachableError(errMessage(err));
  }

  try {
    const config = await client.request({ type: 'get_config' }).catch((err: unknown) => {
      deps.logger?.warn({ event: 'ha-config.read.failed', error: errMessage(err) });
      return null;
    });
    return mapHaConfigResult(config);
  } finally {
    await client.close().catch(() => {
      /* ignore */
    });
  }
}

interface ReadHaConfigDeps {
  readonly clientFactory: () => HaSetupClient;
  readonly logger?: Logger;
}

/**
 * Read the home-zone radius (metres) for the Home Overview seed (#678).
 * `get_config` doesn't carry the radius — it lives on `zone.home`'s
 * `attributes.radius` — so this issues a `get_states` snapshot and narrows
 * it via `mapHomeZoneRadius`. Connection failure is fail-loud
 * (`HaCoreUnreachableError`); a malformed/empty snapshot degrades to
 * `undefined` so the caller falls back to the picker default.
 */
export async function readHomeZoneRadius(deps: ReadHaConfigDeps): Promise<number | undefined> {
  const client = deps.clientFactory();
  try {
    await client.connect();
  } catch (err) {
    throw new HaCoreUnreachableError(errMessage(err));
  }
  try {
    const states = await client.request({ type: 'get_states' }).catch((err: unknown) => {
      deps.logger?.warn({ event: 'ha-config.radius.read.failed', error: errMessage(err) });
      return null;
    });
    return mapHomeZoneRadius(states);
  } finally {
    await client.close().catch(() => {
      /* ignore */
    });
  }
}

/**
 * Production client factory — a real `HaClient` over a direct WS to HA
 * Core, authenticating with the long-lived access token. Heartbeat is
 * disabled: the connection lives only for the duration of one apply run.
 */
export function createHaCoreClientFactory(baseUrl: string, token: string): () => HaSetupClient {
  return () =>
    new HaClient(() => new NodeWsTransport({ baseUrl }), {
      getAccessToken: () => Promise.resolve(token),
      heartbeatIntervalMs: 0,
    });
}

async function runStep(
  step: string,
  logger: Logger | undefined,
  fn: () => Promise<unknown>,
): Promise<ApplyHaStepResult> {
  try {
    await fn();
    logger?.info({ event: 'ha-setup.step.ok', step });
    return { step, ok: true };
  } catch (err) {
    const error = errMessage(err);
    logger?.warn({ event: 'ha-setup.step.failed', step, error });
    return { step, ok: false, error };
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown';
}
