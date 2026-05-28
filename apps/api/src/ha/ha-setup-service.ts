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
  type HaAreaRegistryEntry,
  type HaFloorRegistryEntry,
  type HaSetupInput,
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
