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
    language?: string;
  } = {};

  if (input.latitude !== undefined) core.latitude = input.latitude;
  if (input.longitude !== undefined) core.longitude = input.longitude;
  if (input.unitSystem !== undefined) core.unit_system = mapUnitSystem(input.unitSystem);
  if (input.timezone !== undefined && input.timezone !== '') core.time_zone = input.timezone;
  if (input.country !== undefined && input.country !== '') core.country = input.country;
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
