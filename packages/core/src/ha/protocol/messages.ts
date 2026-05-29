// HA WebSocket protocol — message shapes used by Glaon. See:
// https://developers.home-assistant.io/docs/api/websocket
//
// Inbound (HA → client) frames keep HA's snake_case payload shape verbatim. Outbound
// (client → HA) frames likewise — HaClient stamps the auto-incremented `id` per ADR 0016.

import type { HaEntityState } from '../../types';

/* ---------- Auth handshake ---------- */

export interface HaAuthRequiredFrame {
  readonly type: 'auth_required';
  readonly ha_version: string;
}

export interface HaAuthOkFrame {
  readonly type: 'auth_ok';
  readonly ha_version: string;
}

export interface HaAuthInvalidFrame {
  readonly type: 'auth_invalid';
  readonly message: string;
}

export interface HaAuthFrame {
  readonly type: 'auth';
  readonly access_token: string;
}

/* ---------- Pings + heartbeats ---------- */

export interface HaPingFrame {
  readonly id: number;
  readonly type: 'ping';
}

export interface HaPongFrame {
  readonly id: number;
  readonly type: 'pong';
}

/* ---------- Result frames (response to a numbered request) ---------- */

export interface HaResultFrame<TResult = unknown> {
  readonly id: number;
  readonly type: 'result';
  readonly success: boolean;
  readonly result?: TResult;
  readonly error?: { readonly code: string; readonly message: string };
}

/* ---------- Subscriptions ---------- */

export interface HaSubscribeEventsFrame {
  readonly id: number;
  readonly type: 'subscribe_events';
  readonly event_type?: string;
}

export interface HaSubscribeEntitiesFrame {
  readonly id: number;
  readonly type: 'subscribe_entities';
  readonly entity_ids?: readonly string[];
}

export interface HaUnsubscribeEventsFrame {
  readonly id: number;
  readonly type: 'unsubscribe_events';
  readonly subscription: number;
}

export interface HaEventFrame<TEvent = unknown> {
  readonly id: number;
  readonly type: 'event';
  readonly event: TEvent;
}

/* ---------- Specific events Glaon consumes ---------- */

export interface HaStateChangedEvent {
  readonly event_type: 'state_changed';
  readonly data: {
    readonly entity_id: string;
    readonly old_state: HaEntityState | null;
    readonly new_state: HaEntityState | null;
  };
  readonly origin: 'LOCAL' | 'REMOTE';
  readonly time_fired: string;
}

/* ---------- Service calls ---------- */

export interface HaCallServiceFrame {
  readonly id: number;
  readonly type: 'call_service';
  readonly domain: string;
  readonly service: string;
  readonly service_data?: Readonly<Record<string, unknown>>;
  readonly target?: {
    readonly entity_id?: string | readonly string[];
    readonly area_id?: string | readonly string[];
    readonly device_id?: string | readonly string[];
  };
}

export interface HaGetStatesFrame {
  readonly id: number;
  readonly type: 'get_states';
}

/* ---------- Config writes (setup wizard → HA, #617) ---------- */

/**
 * `config/core/update` — sets HA Core's home location + locale prefs.
 * Every field is optional; HA leaves anything omitted untouched.
 *
 * `unit_system` takes HA's enum values (`metric` / `us_customary`),
 * NOT Glaon's `imperial` — the setup-commands mapper translates.
 */
export interface HaConfigCoreUpdateFrame {
  readonly id: number;
  readonly type: 'config/core/update';
  readonly latitude?: number;
  readonly longitude?: number;
  readonly elevation?: number;
  readonly unit_system?: 'metric' | 'us_customary';
  readonly time_zone?: string;
  readonly currency?: string;
  /** ISO 3166-1 alpha-2 (uppercase). */
  readonly country?: string;
  /** BCP-47 language tag HA recognises (e.g. `en`, `tr`). */
  readonly language?: string;
}

/**
 * `config/floor_registry/create` — creates a floor. Returns the created
 * floor (incl. `floor_id`) in the result frame. `level` orders floors
 * vertically in the HA UI; optional.
 */
export interface HaFloorRegistryCreateFrame {
  readonly id: number;
  readonly type: 'config/floor_registry/create';
  readonly name: string;
  readonly level?: number;
  readonly icon?: string;
}

/** Shape of the `result` payload from `config/floor_registry/create`. */
export interface HaFloorRegistryEntry {
  readonly floor_id: string;
  readonly name: string;
  readonly level?: number | null;
}

/**
 * `config/floor_registry/list` — reads the existing floors so the wizard
 * can pre-fill its layout editor from the device (#638). Result is a
 * `HaFloorRegistryEntry[]`.
 */
export interface HaFloorRegistryListFrame {
  readonly id: number;
  readonly type: 'config/floor_registry/list';
}

/**
 * `config/area_registry/list` — reads the existing areas. Result is a
 * `HaAreaRegistryEntry[]`; each entry's `floor_id` links it to a floor
 * (null/absent → the area has no floor).
 */
export interface HaAreaRegistryListFrame {
  readonly id: number;
  readonly type: 'config/area_registry/list';
}

/**
 * `config/area_registry/create` — creates an area (room). `floor_id`
 * links it to a floor created earlier in the same run; omit it for the
 * graceful-degrade path on HA builds without a floor registry.
 */
export interface HaAreaRegistryCreateFrame {
  readonly id: number;
  readonly type: 'config/area_registry/create';
  readonly name: string;
  readonly floor_id?: string;
}

/** Shape of the `result` payload from `config/area_registry/create`. */
export interface HaAreaRegistryEntry {
  readonly area_id: string;
  readonly name: string;
  readonly floor_id?: string | null;
}

/* ---------- frontend/get_translations (i18n-D / #426) ---------- */

/**
 * HA's localized strings RPC. Returns a flat dictionary of dotted keys
 * (`component.switch.state.off` → `Off`/`Kapalı`) for the given
 * `language` and `category`. Glaon merges the response into i18next
 * under the `ha` namespace; we never re-translate HA-owned content.
 *
 * `category` follows HA's enum. We only ship the values Glaon actually
 * consumes today — `state` (entity state labels) and `entity_component`
 * (device class + service descriptions). HA's full list is broader;
 * extending the union is a one-line change when a new category lands.
 */
export type HaTranslationCategory = 'state' | 'entity_component';

export interface HaGetTranslationsFrame {
  readonly id: number;
  readonly type: 'frontend/get_translations';
  readonly language: string;
  readonly category: HaTranslationCategory;
}

export interface HaTranslationsResult {
  readonly resources?: Readonly<Record<string, string>>;
}

/* ---------- Aggregates ---------- */

export type HaInboundFrame =
  | HaAuthRequiredFrame
  | HaAuthOkFrame
  | HaAuthInvalidFrame
  | HaPongFrame
  | HaResultFrame
  | HaEventFrame;

export type HaOutboundFrame =
  | HaAuthFrame
  | HaPingFrame
  | HaSubscribeEventsFrame
  | HaSubscribeEntitiesFrame
  | HaUnsubscribeEventsFrame
  | HaCallServiceFrame
  | HaGetStatesFrame
  | HaGetTranslationsFrame
  | HaConfigCoreUpdateFrame
  | HaFloorRegistryCreateFrame
  | HaFloorRegistryListFrame
  | HaAreaRegistryCreateFrame
  | HaAreaRegistryListFrame;
