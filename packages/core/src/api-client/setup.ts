// Setup-wizard → HA config push (#617). The request is the subset of
// the device-config the wizard collects that maps onto HA Core config +
// the area/floor registry. apps/web POSTs it to apps/api's
// `POST /setup/apply-ha`; apps/api translates it (via @glaon/core's
// `buildHaSetupPlan`) into HA WebSocket `config/*` commands.
//
// The field names mirror `DeviceConfig` (config/types.ts) so the wizard
// can forward its `collected` blob almost verbatim. The shape is also
// structurally assignable to `HaSetupInput` (ha/setup-commands.ts) — the
// mapper's input type — so apps/api hands the parsed body straight to
// the mapper.

import { z } from 'zod';

const ApplyHaRoomSchema = z.object({
  name: z.string().min(1).max(64),
});

const ApplyHaFloorSchema = z.object({
  name: z.string().min(1).max(64),
  rooms: z.array(ApplyHaRoomSchema).max(50),
});

export const ApplyHaRequestSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  unitSystem: z.union([z.literal('metric'), z.literal('imperial')]).optional(),
  /** IANA TZ name (e.g. `Europe/Istanbul`). */
  timezone: z.string().min(1).optional(),
  /** ISO 3166-1 alpha-2, uppercase. */
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, 'country must be ISO 3166-1 alpha-2 uppercase')
    .optional(),
  /** ISO 4217 currency code, uppercase (e.g. `TRY`, `USD`). */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'currency must be an ISO 4217 alpha-3 uppercase code')
    .optional(),
  /** BCP-47 locale tag (e.g. `tr`, `en-US`). */
  locale: z.string().min(1).optional(),
  layout: z
    .object({
      floors: z.array(ApplyHaFloorSchema).min(1).max(10),
    })
    .optional(),
});
export type ApplyHaRequest = z.infer<typeof ApplyHaRequestSchema>;

/**
 * Per-command outcome. `step` is a stable label —
 * `core` | `floor:<name>` | `area:<name>` — so the client can map a
 * failure back to a specific section if it wants. apps/api runs every
 * step even when an earlier one fails (best-effort), so the array
 * always reflects the full attempted set.
 */
export const ApplyHaStepResultSchema = z.object({
  step: z.string().min(1),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type ApplyHaStepResult = z.infer<typeof ApplyHaStepResultSchema>;

export const ApplyHaResponseSchema = z.object({
  /** True only when every attempted step succeeded. */
  ok: z.boolean(),
  steps: z.array(ApplyHaStepResultSchema),
});
export type ApplyHaResponse = z.infer<typeof ApplyHaResponseSchema>;

/**
 * Response from `GET /setup/ha-layout` (#638): the device's existing HA
 * floors + areas, normalized so the wizard's Layout step can pre-fill its
 * editor. `unassigned` holds areas with no floor — the step buckets them
 * under a default-named floor. Structurally matches `HaLayoutResult`
 * (ha/setup-commands.ts), the pure mapper apps/api builds it from.
 */
const HaLayoutRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
});
const HaLayoutFloorSchema = z.object({
  id: z.string(),
  name: z.string(),
  rooms: z.array(HaLayoutRoomSchema),
});
export const HaLayoutResponseSchema = z.object({
  floors: z.array(HaLayoutFloorSchema),
  unassigned: z.array(HaLayoutRoomSchema),
});
export type HaLayoutResponse = z.infer<typeof HaLayoutResponseSchema>;

/**
 * Response from `GET /setup/ha-config` (#646): the device's current HA
 * Core config, narrowed to the Home Overview seed. Every field is
 * optional — present only when HA reported a usable value. Structurally
 * matches `HaConfigSeed` (ha/setup-commands.ts), the pure mapper apps/api
 * builds it from.
 */
/**
 * Request body for `POST /setup/ha-layout` (#652): the wizard's desired
 * layout. Floor/room ids are either HA registry ids (seeded entities) or
 * client UUIDs (newly added) — the server's reconcile matches by id.
 * Structurally matches `ReconcileLayoutInput` (ha/setup-commands.ts). Room
 * `type` is intentionally not accepted: it's app-local and never reaches
 * the HA area registry.
 */
const ReconcileRoomSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(64) });
const ReconcileFloorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  rooms: z.array(ReconcileRoomSchema).max(50),
});
export const ReconcileLayoutRequestSchema = z.object({
  floors: z.array(ReconcileFloorSchema).min(1).max(10),
});
export type ReconcileLayoutRequest = z.infer<typeof ReconcileLayoutRequestSchema>;

export const HaConfigResponseSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  unitSystem: z.union([z.literal('metric'), z.literal('imperial')]).optional(),
  timezone: z.string().optional(),
  country: z.string().optional(),
  currency: z.string().optional(),
  language: z.string().optional(),
  locationName: z.string().optional(),
});
export type HaConfigResponse = z.infer<typeof HaConfigResponseSchema>;

// ---- Unified wizard seed: GET /setup (#678) ----

/**
 * Home Overview section of the unified seed — the HA Core `get_config`
 * fields (`HaConfigResponseSchema`) plus the home-zone `radius` (metres),
 * which lives on `zone.home`, not `get_config`, so it's read separately.
 */
const SetupHomeOverviewSchema = HaConfigResponseSchema.extend({
  radius: z.number().optional(),
});
export type SetupHomeOverview = z.infer<typeof SetupHomeOverviewSchema>;

/**
 * Network section of the unified seed — the Supervisor `/host/info`
 * hostname + the `/network/info` interfaces. `interfaces` stays loosely
 * typed (passthrough): the Network step owns the detailed interface
 * parsing; the seed just forwards the Supervisor payload.
 */
const SetupNetworkSchema = z.object({
  hostname: z.string().optional(),
  interfaces: z.array(z.unknown()).optional(),
});
export type SetupNetwork = z.infer<typeof SetupNetworkSchema>;

/**
 * Unified wizard device seed returned by `GET /setup` (#678). Grouped by
 * wizard step. **Each section is independently nullable**: a section is
 * `null` when its source is unconfigured or unreachable (HA Core for
 * `homeOverview`/`layout`, the Supervisor for `network`), so the wizard
 * seeds whatever is present and degrades the rest. The endpoint returns
 * 200 even when some sections are null.
 */
export const SetupSeedResponseSchema = z.object({
  homeOverview: SetupHomeOverviewSchema.nullable(),
  layout: HaLayoutResponseSchema.nullable(),
  network: SetupNetworkSchema.nullable(),
  /**
   * Languages offered by the Home Overview language picker (#683), sourced
   * by the server: the HA-supported set (`HA_LANGUAGES`) with the device's
   * current `get_config.language` guaranteed present. Always non-null — even
   * when HA Core is unconfigured the static set is available. BCP-47 codes.
   */
  languages: z.array(z.string()),
});
export type SetupSeedResponse = z.infer<typeof SetupSeedResponseSchema>;
