// Setup-wizard → HA config mapping (#617). Pure translation from the
// subset of the device-config the wizard collects into the ordered set
// of HA WebSocket `config/*` commands that materialise it in Home
// Assistant. No I/O here — the apps/api `ha-setup-service` executes the
// plan over a live `HaClient`, threading the floor_id results into the
// area-create calls (a data dependency a flat frame list can't express,
// hence the structured plan).
//
// Why a structured plan rather than a flat `HaOutboundFrame[]`:
//   - `config/area_registry/create` needs the `floor_id` returned by
//     the matching `config/floor_registry/create` — a runtime value
//     not knowable at mapping time.
//   - Keeping the mapping pure (DeviceConfig subset → plan) makes it
//     unit-testable without a WS, and lets the service own the one
//     imperative concern (id threading + graceful degrade).

import type { HaAreaRegistryEntry, HaFloorRegistryEntry } from './protocol/messages';

/**
 * The wizard-collected fields this mapper reads. Structurally a subset
 * of `DeviceConfigInput` (config/types.ts) — kept as a standalone shape
 * so the `ha/` module doesn't take a hard dependency on the `config/`
 * schema. The api-client `ApplyHaRequest` is assignable to this.
 */
// Optional fields carry an explicit `| undefined`: this type is the
// bridge for the api-client `ApplyHaRequest` (Zod `.optional()` infers
// `T | undefined`), and under `exactOptionalPropertyTypes` a bare `T?`
// would reject that. The mapper guards every field on `!== undefined`,
// so explicit-undefined is semantically a no-op.
export interface HaSetupInput {
  readonly latitude?: number | undefined;
  readonly longitude?: number | undefined;
  /** Glaon's unit system; mapped to HA's `metric` / `us_customary`. */
  readonly unitSystem?: 'metric' | 'imperial' | undefined;
  /** IANA TZ name (e.g. `Europe/Istanbul`). */
  readonly timezone?: string | undefined;
  /** ISO 3166-1 alpha-2 (uppercase). */
  readonly country?: string | undefined;
  /** ISO 4217 currency code (e.g. `TRY`, `USD`). */
  readonly currency?: string | undefined;
  /** BCP-47 locale tag; forwarded to HA `language` best-effort. */
  readonly locale?: string | undefined;
  readonly layout?:
    | {
        readonly floors: readonly {
          readonly name: string;
          readonly rooms: readonly { readonly name: string }[];
        }[];
      }
    | undefined;
}

/** `config/core/update` payload (frame fields minus `id`/`type`). */
export interface HaCoreUpdatePayload {
  readonly latitude?: number;
  readonly longitude?: number;
  readonly unit_system?: 'metric' | 'us_customary';
  readonly time_zone?: string;
  readonly country?: string;
  readonly currency?: string;
  readonly language?: string;
}

export interface HaFloorPlan {
  readonly name: string;
  /** Vertical ordering hint for HA's UI; derived from floor index. */
  readonly level: number;
  readonly rooms: readonly { readonly name: string }[];
}

export interface HaSetupPlan {
  /** `null` when the wizard collected no core-config fields. */
  readonly coreUpdate: HaCoreUpdatePayload | null;
  readonly floors: readonly HaFloorPlan[];
}

/**
 * Translate the wizard subset into an ordered HA setup plan. Pure.
 *
 * Core-config fields are only included when present, so HA leaves any
 * field the user didn't touch untouched. `coreUpdate` is `null` (rather
 * than an empty object) when nothing maps, letting the service skip the
 * command entirely.
 */
export function buildHaSetupPlan(input: HaSetupInput): HaSetupPlan {
  const core: {
    latitude?: number;
    longitude?: number;
    unit_system?: 'metric' | 'us_customary';
    time_zone?: string;
    country?: string;
    currency?: string;
    language?: string;
  } = {};

  if (input.latitude !== undefined) core.latitude = input.latitude;
  if (input.longitude !== undefined) core.longitude = input.longitude;
  if (input.unitSystem !== undefined) core.unit_system = mapUnitSystem(input.unitSystem);
  if (input.timezone !== undefined && input.timezone !== '') core.time_zone = input.timezone;
  if (input.country !== undefined && input.country !== '') core.country = input.country;
  if (input.currency !== undefined && input.currency !== '') core.currency = input.currency;
  const language = mapLanguage(input.locale);
  if (language !== undefined) core.language = language;

  const coreUpdate = Object.keys(core).length > 0 ? core : null;

  const floors: HaFloorPlan[] = (input.layout?.floors ?? []).map((floor, index) => ({
    name: floor.name,
    level: index,
    rooms: floor.rooms.map((room) => ({ name: room.name })),
  }));

  return { coreUpdate, floors };
}

// ---- Reverse direction: HA get_config → Home Overview seed (#646) ----

/**
 * The Home Overview fields seeded from the device's current HA config.
 * Mirrors the `HaSetupInput` core fields plus `currency` (CurrencyPicker,
 * #649) and `locationName` (HA's home name). Every field is optional — a
 * value is only present when HA reported a usable one.
 */
export interface HaConfigSeed {
  readonly latitude?: number;
  readonly longitude?: number;
  readonly unitSystem?: 'metric' | 'imperial';
  /** IANA TZ name (e.g. `Europe/Istanbul`). */
  readonly timezone?: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  readonly country?: string;
  /** ISO 4217 currency code (e.g. `TRY`, `USD`). */
  readonly currency?: string;
  /** BCP-47 / short language code HA reported (e.g. `en`, `tr`). */
  readonly language?: string;
  /** HA's home name (`location_name`). */
  readonly locationName?: string;
}

/**
 * Narrow HA's `get_config` result into the wizard's Home Overview seed.
 * Pure + defensive: the input is `unknown` (whatever the WS returned), so
 * every field is type-guarded and only forwarded when usable. HA reports
 * `unit_system` as an object (`{ temperature, length, ... }`); we derive
 * Glaon's `metric` / `imperial` from the temperature unit (°C → metric).
 */
export function mapHaConfigResult(raw: unknown): HaConfigSeed {
  if (raw === null || typeof raw !== 'object') return {};
  const cfg = raw as {
    latitude?: unknown;
    longitude?: unknown;
    unit_system?: unknown;
    time_zone?: unknown;
    country?: unknown;
    currency?: unknown;
    language?: unknown;
    location_name?: unknown;
  };

  const seed: {
    latitude?: number;
    longitude?: number;
    unitSystem?: 'metric' | 'imperial';
    timezone?: string;
    country?: string;
    currency?: string;
    language?: string;
    locationName?: string;
  } = {};

  if (typeof cfg.latitude === 'number' && Number.isFinite(cfg.latitude)) {
    seed.latitude = cfg.latitude;
  }
  if (typeof cfg.longitude === 'number' && Number.isFinite(cfg.longitude)) {
    seed.longitude = cfg.longitude;
  }
  const unitSystem = deriveUnitSystem(cfg.unit_system);
  if (unitSystem !== undefined) seed.unitSystem = unitSystem;
  if (typeof cfg.time_zone === 'string' && cfg.time_zone !== '') seed.timezone = cfg.time_zone;
  if (typeof cfg.country === 'string' && /^[A-Za-z]{2}$/.test(cfg.country)) {
    seed.country = cfg.country.toUpperCase();
  }
  if (typeof cfg.currency === 'string' && cfg.currency !== '') seed.currency = cfg.currency;
  if (typeof cfg.language === 'string' && cfg.language !== '') seed.language = cfg.language;
  if (typeof cfg.location_name === 'string' && cfg.location_name !== '') {
    seed.locationName = cfg.location_name;
  }

  return seed;
}

/**
 * HA's `unit_system` is an object of per-dimension unit strings. Glaon
 * only distinguishes `metric` vs `imperial`; the temperature unit is the
 * least ambiguous signal (`°C` → metric, `°F` → imperial). Returns
 * `undefined` when the shape is unrecognised so the field is omitted.
 */
function deriveUnitSystem(raw: unknown): 'metric' | 'imperial' | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const temperature = (raw as { temperature?: unknown }).temperature;
  if (typeof temperature !== 'string') return undefined;
  if (temperature.includes('C')) return 'metric';
  if (temperature.includes('F')) return 'imperial';
  return undefined;
}

// ---- Reverse direction: HA registries → wizard layout seed (#638) ----

export interface HaLayoutRoom {
  readonly id: string;
  readonly name: string;
}

export interface HaLayoutFloor {
  readonly id: string;
  readonly name: string;
  readonly rooms: readonly HaLayoutRoom[];
}

/**
 * Result of reading HA's floor + area registries: floors with their
 * rooms, plus the areas that have no floor link. The consumer (the
 * wizard's Layout step) buckets `unassigned` under a default-named floor
 * — naming stays in the UI layer where i18n lives.
 */
export interface HaLayoutResult {
  readonly floors: readonly HaLayoutFloor[];
  readonly unassigned: readonly HaLayoutRoom[];
}

/**
 * Group HA areas under their floors to seed the wizard's layout editor.
 * Pure. Floors are ordered by `level` (nullish last, stable otherwise);
 * areas whose `floor_id` is null/absent/unknown land in `unassigned`.
 */
export function buildLayoutFromRegistries(
  floors: readonly HaFloorRegistryEntry[],
  areas: readonly HaAreaRegistryEntry[],
): HaLayoutResult {
  const knownFloorIds = new Set(floors.map((f) => f.floor_id));
  const roomsByFloor = new Map<string, HaLayoutRoom[]>();
  const unassigned: HaLayoutRoom[] = [];

  for (const area of areas) {
    const room: HaLayoutRoom = { id: area.area_id, name: area.name };
    const floorId = area.floor_id;
    if (floorId !== null && floorId !== undefined && floorId !== '' && knownFloorIds.has(floorId)) {
      const list = roomsByFloor.get(floorId) ?? [];
      list.push(room);
      roomsByFloor.set(floorId, list);
    } else {
      unassigned.push(room);
    }
  }

  const ordered = [...floors].sort(
    (a, b) => (a.level ?? Number.POSITIVE_INFINITY) - (b.level ?? Number.POSITIVE_INFINITY),
  );
  const mappedFloors: HaLayoutFloor[] = ordered.map((floor) => ({
    id: floor.floor_id,
    name: floor.name,
    rooms: roomsByFloor.get(floor.floor_id) ?? [],
  }));

  return { floors: mappedFloors, unassigned };
}

// ---- Layout reconcile: desired Layout vs existing HA registries (#652) ----

/** Desired layout shape the reconcile reads (subset of config `Layout`). */
export interface ReconcileLayoutInput {
  readonly floors: readonly {
    readonly id: string;
    readonly name: string;
    readonly rooms: readonly { readonly id: string; readonly name: string }[];
  }[];
}

/** A floor reference an area's create/update points at. `new` floors are
 *  created first; the service resolves `key` to the returned floor_id. */
export type FloorRef =
  | { readonly kind: 'existing'; readonly floorId: string }
  | { readonly kind: 'new'; readonly key: string };

export interface ReconcileFloorCreate {
  /** The desired floor's client id — the thread key areas reference. */
  readonly key: string;
  readonly name: string;
  readonly level: number;
}
export interface ReconcileFloorUpdate {
  readonly floorId: string;
  readonly name: string;
}
export interface ReconcileAreaCreate {
  readonly name: string;
  readonly floor: FloorRef;
}
export interface ReconcileAreaUpdate {
  readonly areaId: string;
  /** Present only when the name changed. */
  readonly name?: string;
  /** Present only when the floor changed (rename-only updates omit it). */
  readonly floor?: FloorRef;
}

/**
 * Idempotent reconcile plan: what to create / update / delete so HA's
 * floor + area registries match the wizard's desired layout (#652). Pure —
 * the service (`reconcileHaLayout`) executes it, threading created floor
 * ids into the areas that point at them. Ordering for the executor:
 * create floors → create/update areas → delete areas → delete floors
 * (floors last so areas are moved off them before removal).
 */
export interface LayoutReconcilePlan {
  readonly floorsToCreate: readonly ReconcileFloorCreate[];
  readonly floorsToUpdate: readonly ReconcileFloorUpdate[];
  readonly floorIdsToDelete: readonly string[];
  readonly areasToCreate: readonly ReconcileAreaCreate[];
  readonly areasToUpdate: readonly ReconcileAreaUpdate[];
  readonly areaIdsToDelete: readonly string[];
}

/**
 * Diff the device's current registries (`existing`, from
 * `buildLayoutFromRegistries`) against the wizard's `desired` layout and
 * produce a reconcile plan. Matching is by id: a desired floor/room whose
 * id equals an existing registry id is the same entity (rename/reparent);
 * an unmatched desired entity is new (create); an existing id absent from
 * the desired layout is removed (delete). Pure + deterministic.
 */
export function buildLayoutReconcilePlan(
  existing: HaLayoutResult,
  desired: ReconcileLayoutInput,
): LayoutReconcilePlan {
  const existingFloorIds = new Set(existing.floors.map((f) => f.id));
  const existingFloorNameById = new Map(existing.floors.map((f) => [f.id, f.name]));

  // area_id → { name, floorId|null } across assigned + unassigned areas.
  const existingAreas = new Map<string, { name: string; floorId: string | null }>();
  for (const floor of existing.floors) {
    for (const room of floor.rooms)
      existingAreas.set(room.id, { name: room.name, floorId: floor.id });
  }
  for (const room of existing.unassigned) {
    existingAreas.set(room.id, { name: room.name, floorId: null });
  }

  const floorsToCreate: ReconcileFloorCreate[] = [];
  const floorsToUpdate: ReconcileFloorUpdate[] = [];
  const areasToCreate: ReconcileAreaCreate[] = [];
  const areasToUpdate: ReconcileAreaUpdate[] = [];

  const desiredFloorIds = new Set<string>();
  const desiredAreaIds = new Set<string>();

  desired.floors.forEach((floor, index) => {
    desiredFloorIds.add(floor.id);
    const floorIsExisting = existingFloorIds.has(floor.id);
    if (floorIsExisting) {
      if (existingFloorNameById.get(floor.id) !== floor.name) {
        floorsToUpdate.push({ floorId: floor.id, name: floor.name });
      }
    } else {
      floorsToCreate.push({ key: floor.id, name: floor.name, level: index });
    }
    const floorRef: FloorRef = floorIsExisting
      ? { kind: 'existing', floorId: floor.id }
      : { kind: 'new', key: floor.id };

    for (const room of floor.rooms) {
      desiredAreaIds.add(room.id);
      const prior = existingAreas.get(room.id);
      if (prior === undefined) {
        areasToCreate.push({ name: room.name, floor: floorRef });
        continue;
      }
      const nameChanged = prior.name !== room.name;
      // Floor changed when the target is a brand-new floor, or an existing
      // floor id that differs from where the area currently sits.
      const floorChanged = floorRef.kind === 'new' ? true : prior.floorId !== floorRef.floorId;
      if (nameChanged || floorChanged) {
        areasToUpdate.push({
          areaId: room.id,
          ...(nameChanged ? { name: room.name } : {}),
          ...(floorChanged ? { floor: floorRef } : {}),
        });
      }
    }
  });

  const floorIdsToDelete = existing.floors
    .map((f) => f.id)
    .filter((id) => !desiredFloorIds.has(id));
  const areaIdsToDelete = [...existingAreas.keys()].filter((id) => !desiredAreaIds.has(id));

  return {
    floorsToCreate,
    floorsToUpdate,
    floorIdsToDelete,
    areasToCreate,
    areasToUpdate,
    areaIdsToDelete,
  };
}

/**
 * Glaon's `imperial` is HA's `us_customary`; `metric` is shared. Kept
 * as a function (not a record) so an unexpected value fails the type
 * check at the call site rather than silently producing `undefined`.
 */
function mapUnitSystem(unit: 'metric' | 'imperial'): 'metric' | 'us_customary' {
  return unit === 'imperial' ? 'us_customary' : 'metric';
}

/**
 * Forward the locale's primary subtag as HA's `language` (HA expects a
 * short language code like `en` / `tr`, not a full BCP-47 region tag).
 * Returns `undefined` for empty / missing input so the caller omits the
 * field. HA still validates against its supported set — an unsupported
 * code surfaces as that single command's failure, not the whole run's.
 */
function mapLanguage(locale: string | undefined): string | undefined {
  if (locale === undefined || locale === '') return undefined;
  const primary = locale.split('-')[0];
  if (primary === undefined || primary === '') return undefined;
  return primary.toLowerCase();
}
