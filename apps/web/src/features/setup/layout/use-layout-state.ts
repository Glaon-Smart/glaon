// Layout-editor state — `useReducer` over the Floor[] array.
// Kept in its own module so the unit test can drive every action
// without mounting the React tree (faster + ID-stable).
//
// Action shape mirrors the editor surface 1:1 — every UI affordance
// (add/remove/rename for floors and rooms; pick a room type; switch
// active floor) maps to a single action type. Reducer is pure
// modulo the new-id generation injected via the `idFactory` arg
// (deterministic test ids in jsdom, `crypto.randomUUID()` in
// browsers).

import { useCallback, useMemo, useReducer } from 'react';

import type { Floor, Layout, Room, RoomType } from '@glaon/core/config';

export interface LayoutState {
  readonly floors: readonly Floor[];
  /** id of the floor currently visible in the editor's right pane. */
  readonly activeFloorId: string;
}

// Both kept un-exported per memory note
// `feedback_knip_props_interfaces.md` — `LayoutAction` and
// `LayoutReducerContext` are consumed only inside this file.
// Promote when an external consumer arrives.
type LayoutAction =
  | { kind: 'switchFloor'; floorId: string }
  | { kind: 'addFloor'; name: string }
  | { kind: 'renameFloor'; floorId: string; name: string }
  | { kind: 'removeFloor'; floorId: string }
  | { kind: 'addRoom'; floorId: string; name: string }
  | { kind: 'renameRoom'; floorId: string; roomId: string; name: string }
  | { kind: 'changeRoomType'; floorId: string; roomId: string; type: RoomType | undefined }
  | { kind: 'removeRoom'; floorId: string; roomId: string };

interface LayoutReducerContext {
  /** Returns the next room/floor id. Override in tests for determinism. */
  readonly idFactory: () => string;
}

export function makeReducer(ctx: LayoutReducerContext) {
  const { idFactory } = ctx;
  return function reducer(state: LayoutState, action: LayoutAction): LayoutState {
    switch (action.kind) {
      case 'switchFloor': {
        if (!state.floors.some((floor) => floor.id === action.floorId)) return state;
        return { ...state, activeFloorId: action.floorId };
      }
      case 'addFloor': {
        // Cap at 10 mirrors the schema's `z.array(...).max(10)` — UI
        // should hide the affordance before this fires, but the
        // guard is here so a renegade caller can't over-add.
        if (state.floors.length >= 10) return state;
        const newFloor: Floor = { id: idFactory(), name: action.name, rooms: [] };
        return { floors: [...state.floors, newFloor], activeFloorId: newFloor.id };
      }
      case 'renameFloor': {
        const trimmed = action.name.trim();
        if (trimmed === '') return state;
        return {
          ...state,
          floors: state.floors.map((floor) =>
            floor.id === action.floorId ? { ...floor, name: trimmed } : floor,
          ),
        };
      }
      case 'removeFloor': {
        // Never remove the last floor — at least one is required by
        // both the schema and the wizard's UX contract.
        if (state.floors.length <= 1) return state;
        const remaining = state.floors.filter((floor) => floor.id !== action.floorId);
        if (remaining.length === state.floors.length) return state;
        const wasActive = state.activeFloorId === action.floorId;
        const nextActive = wasActive
          ? (remaining[0]?.id ?? state.activeFloorId)
          : state.activeFloorId;
        return { floors: remaining, activeFloorId: nextActive };
      }
      case 'addRoom': {
        return {
          ...state,
          floors: state.floors.map((floor) => {
            if (floor.id !== action.floorId) return floor;
            if (floor.rooms.length >= 50) return floor;
            const newRoom: Room = { id: idFactory(), name: action.name };
            return { ...floor, rooms: [...floor.rooms, newRoom] };
          }),
        };
      }
      case 'renameRoom': {
        const trimmed = action.name.trim();
        if (trimmed === '') return state;
        return {
          ...state,
          floors: state.floors.map((floor) => {
            if (floor.id !== action.floorId) return floor;
            return {
              ...floor,
              rooms: floor.rooms.map((room) =>
                room.id === action.roomId ? { ...room, name: trimmed } : room,
              ),
            };
          }),
        };
      }
      case 'changeRoomType': {
        return {
          ...state,
          floors: state.floors.map((floor) => {
            if (floor.id !== action.floorId) return floor;
            return {
              ...floor,
              rooms: floor.rooms.map((room) => {
                if (room.id !== action.roomId) return room;
                // `exactOptionalPropertyTypes: true` — build the room
                // bag conditionally instead of passing explicit
                // `undefined` for `type`.
                const next: Room = { id: room.id, name: room.name };
                if (action.type !== undefined) next.type = action.type;
                return next;
              }),
            };
          }),
        };
      }
      case 'removeRoom': {
        return {
          ...state,
          floors: state.floors.map((floor) => {
            if (floor.id !== action.floorId) return floor;
            return { ...floor, rooms: floor.rooms.filter((room) => room.id !== action.roomId) };
          }),
        };
      }
    }
  };
}

/**
 * Default id factory — `crypto.randomUUID()` in modern browsers.
 * Replaced in jsdom tests with a deterministic counter.
 */
// Internal — same memory-note rationale as the types above.
// `useLayoutState` reads it as the default `idFactory`; tests
// inject their own deterministic factory.
function defaultIdFactory(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Pre-crypto.randomUUID fallback (rare). Math.random is OK because
  // the id is opaque — uniqueness inside a single config blob is all
  // we need.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface UseLayoutStateOptions {
  /** Default floor name when seeding an empty editor. */
  readonly defaultFloorName: string;
  /** Hydrate from a previously persisted `layout` blob if present. */
  readonly initial?: Layout;
  /** Override in tests for deterministic ids. */
  readonly idFactory?: () => string;
}

/**
 * Hook over the reducer. Returns the current state, a memoised set
 * of action dispatchers (keeps deps arrays in consumers stable),
 * and a helper to project the state back into a `Layout` blob
 * suitable for the wizard's `onNext` callback.
 */
export function useLayoutState(opts: UseLayoutStateOptions) {
  const { defaultFloorName, initial, idFactory = defaultIdFactory } = opts;

  const initialState = useMemo<LayoutState>(() => {
    if (initial !== undefined && initial.floors.length > 0) {
      // We mutate the array shape (.slice) so the reducer sees a
      // plain `Floor[]` rather than a frozen zod-inferred tuple.
      const floors = [...initial.floors];
      const first = floors[0];
      if (first === undefined) {
        // Type narrow — `floors[0]` is `Floor | undefined` even
        // after the `.length > 0` check above.
        const seed: Floor = { id: idFactory(), name: defaultFloorName, rooms: [] };
        return { floors: [seed], activeFloorId: seed.id };
      }
      return { floors, activeFloorId: first.id };
    }
    const seed: Floor = { id: idFactory(), name: defaultFloorName, rooms: [] };
    return { floors: [seed], activeFloorId: seed.id };
    // Initialiser intentionally runs once; subsequent `defaultFloorName`
    // changes (i18n locale switch mid-session) don't rename the
    // existing seed floor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reducer = useMemo(() => makeReducer({ idFactory }), [idFactory]);
  const [state, dispatch] = useReducer(reducer, initialState);

  const actions = useMemo(
    () => ({
      switchFloor: (floorId: string) => {
        dispatch({ kind: 'switchFloor', floorId });
      },
      addFloor: (name: string) => {
        dispatch({ kind: 'addFloor', name });
      },
      renameFloor: (floorId: string, name: string) => {
        dispatch({ kind: 'renameFloor', floorId, name });
      },
      removeFloor: (floorId: string) => {
        dispatch({ kind: 'removeFloor', floorId });
      },
      addRoom: (floorId: string, name: string) => {
        dispatch({ kind: 'addRoom', floorId, name });
      },
      renameRoom: (floorId: string, roomId: string, name: string) => {
        dispatch({ kind: 'renameRoom', floorId, roomId, name });
      },
      changeRoomType: (floorId: string, roomId: string, type: RoomType | undefined) => {
        dispatch({ kind: 'changeRoomType', floorId, roomId, type });
      },
      removeRoom: (floorId: string, roomId: string) => {
        dispatch({ kind: 'removeRoom', floorId, roomId });
      },
    }),
    [],
  );

  const toLayout = useCallback((): Layout => ({ floors: [...state.floors] }), [state.floors]);

  return { state, actions, toLayout };
}
