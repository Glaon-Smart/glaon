// Pure reducer tests — no DOM, no React. Driven via the
// deterministic id factory so assertions can pin specific ids.

import { describe, expect, it } from 'vitest';

import type { Floor } from '@glaon/core/config';

import { makeReducer, type LayoutState } from './use-layout-state';

function makeIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `id-${counter.toString()}`;
  };
}

function seed(floors: Floor[], activeFloorId: string): LayoutState {
  return { floors, activeFloorId };
}

describe('layout reducer', () => {
  describe('switchFloor', () => {
    it('switches to a known floor', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed(
        [
          { id: 'a', name: 'A', rooms: [] },
          { id: 'b', name: 'B', rooms: [] },
        ],
        'a',
      );
      const next = reducer(initial, { kind: 'switchFloor', floorId: 'b' });
      expect(next.activeFloorId).toBe('b');
    });

    it('is a no-op for an unknown floor id', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed([{ id: 'a', name: 'A', rooms: [] }], 'a');
      expect(reducer(initial, { kind: 'switchFloor', floorId: 'ghost' })).toBe(initial);
    });
  });

  describe('addFloor', () => {
    it('appends a floor and makes it active', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed([{ id: 'a', name: 'A', rooms: [] }], 'a');
      const next = reducer(initial, { kind: 'addFloor', name: '2nd Floor' });
      expect(next.floors).toHaveLength(2);
      expect(next.floors[1]?.name).toBe('2nd Floor');
      expect(next.activeFloorId).toBe(next.floors[1]?.id);
    });

    it('caps at 10 floors', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const ten = Array.from({ length: 10 }, (_, idx) => ({
        id: `f-${idx.toString()}`,
        name: `Floor ${idx.toString()}`,
        rooms: [],
      }));
      const initial = seed(ten, 'f-0');
      expect(reducer(initial, { kind: 'addFloor', name: '11' })).toBe(initial);
    });
  });

  describe('renameFloor', () => {
    it('renames the matching floor and trims whitespace', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed([{ id: 'a', name: 'A', rooms: [] }], 'a');
      const next = reducer(initial, { kind: 'renameFloor', floorId: 'a', name: '  Loft  ' });
      expect(next.floors[0]?.name).toBe('Loft');
    });

    it('rejects an empty rename', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed([{ id: 'a', name: 'A', rooms: [] }], 'a');
      expect(reducer(initial, { kind: 'renameFloor', floorId: 'a', name: '   ' })).toBe(initial);
    });
  });

  describe('removeFloor', () => {
    it('removes a non-active floor', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed(
        [
          { id: 'a', name: 'A', rooms: [] },
          { id: 'b', name: 'B', rooms: [] },
        ],
        'a',
      );
      const next = reducer(initial, { kind: 'removeFloor', floorId: 'b' });
      expect(next.floors.map((f) => f.id)).toEqual(['a']);
      expect(next.activeFloorId).toBe('a');
    });

    it('switches the active floor when the active one is removed', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed(
        [
          { id: 'a', name: 'A', rooms: [] },
          { id: 'b', name: 'B', rooms: [] },
        ],
        'b',
      );
      const next = reducer(initial, { kind: 'removeFloor', floorId: 'b' });
      expect(next.floors.map((f) => f.id)).toEqual(['a']);
      expect(next.activeFloorId).toBe('a');
    });

    it('blocks removing the last floor', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed([{ id: 'a', name: 'A', rooms: [] }], 'a');
      expect(reducer(initial, { kind: 'removeFloor', floorId: 'a' })).toBe(initial);
    });
  });

  describe('addRoom', () => {
    it('appends a room to the target floor', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed(
        [
          { id: 'a', name: 'A', rooms: [] },
          { id: 'b', name: 'B', rooms: [] },
        ],
        'a',
      );
      const next = reducer(initial, { kind: 'addRoom', floorId: 'a', name: 'Kitchen' });
      expect(next.floors[0]?.rooms).toHaveLength(1);
      expect(next.floors[0]?.rooms[0]?.name).toBe('Kitchen');
      expect(next.floors[1]?.rooms).toHaveLength(0);
    });

    it('caps at 50 rooms per floor', () => {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const fifty = Array.from({ length: 50 }, (_, idx) => ({
        id: `r-${idx.toString()}`,
        name: `Room ${idx.toString()}`,
      }));
      const initial = seed([{ id: 'a', name: 'A', rooms: fifty }], 'a');
      const next = reducer(initial, { kind: 'addRoom', floorId: 'a', name: 'Overflow' });
      expect(next.floors[0]?.rooms).toHaveLength(50);
    });
  });

  describe('renameRoom + changeRoomType + removeRoom', () => {
    function setup() {
      const reducer = makeReducer({ idFactory: makeIdFactory() });
      const initial = seed(
        [
          {
            id: 'a',
            name: 'A',
            rooms: [
              { id: 'r1', name: 'Kitchen', type: 'kitchen' },
              { id: 'r2', name: 'Bath' },
            ],
          },
        ],
        'a',
      );
      return { reducer, initial };
    }

    it('renames a room and trims whitespace', () => {
      const { reducer, initial } = setup();
      const next = reducer(initial, {
        kind: 'renameRoom',
        floorId: 'a',
        roomId: 'r1',
        name: '  Galley  ',
      });
      expect(next.floors[0]?.rooms[0]?.name).toBe('Galley');
    });

    it('changes a room type from unset to bedroom', () => {
      const { reducer, initial } = setup();
      const next = reducer(initial, {
        kind: 'changeRoomType',
        floorId: 'a',
        roomId: 'r2',
        type: 'bedroom',
      });
      expect(next.floors[0]?.rooms[1]?.type).toBe('bedroom');
    });

    it('clears a room type when set to undefined', () => {
      const { reducer, initial } = setup();
      const next = reducer(initial, {
        kind: 'changeRoomType',
        floorId: 'a',
        roomId: 'r1',
        type: undefined,
      });
      expect(next.floors[0]?.rooms[0]?.type).toBeUndefined();
    });

    it('removes a room by id', () => {
      const { reducer, initial } = setup();
      const next = reducer(initial, { kind: 'removeRoom', floorId: 'a', roomId: 'r1' });
      expect(next.floors[0]?.rooms.map((r) => r.id)).toEqual(['r2']);
    });
  });
});
