import { describe, expect, it } from 'vitest';

import type { HaAreaRegistryEntry, HaFloorRegistryEntry } from './protocol/messages';
import {
  buildHaSetupPlan,
  buildLayoutFromRegistries,
  buildLayoutReconcilePlan,
  mapHaConfigResult,
  mapHomeZoneRadius,
  type HaSetupInput,
} from './setup-commands';

describe('buildHaSetupPlan — core config', () => {
  it('maps every collected core field into config/core/update', () => {
    const input: HaSetupInput = {
      latitude: 41.0082,
      longitude: 28.9784,
      unitSystem: 'metric',
      timezone: 'Europe/Istanbul',
      country: 'TR',
      currency: 'TRY',
      locale: 'tr',
    };
    const plan = buildHaSetupPlan(input);
    expect(plan.coreUpdate).toEqual({
      latitude: 41.0082,
      longitude: 28.9784,
      unit_system: 'metric',
      time_zone: 'Europe/Istanbul',
      country: 'TR',
      currency: 'TRY',
      language: 'tr',
    });
  });

  it('translates imperial → us_customary', () => {
    const plan = buildHaSetupPlan({ unitSystem: 'imperial' });
    expect(plan.coreUpdate).toEqual({ unit_system: 'us_customary' });
  });

  it('takes the primary subtag of a region locale for language', () => {
    const plan = buildHaSetupPlan({ locale: 'pt-BR' });
    expect(plan.coreUpdate).toEqual({ language: 'pt' });
  });

  it('omits fields the wizard did not collect (HA leaves them untouched)', () => {
    const plan = buildHaSetupPlan({ latitude: 1, longitude: 2 });
    expect(plan.coreUpdate).toEqual({ latitude: 1, longitude: 2 });
  });

  it('returns coreUpdate=null when no core field is present', () => {
    const plan = buildHaSetupPlan({});
    expect(plan.coreUpdate).toBeNull();
  });

  it('treats empty-string timezone / country as absent', () => {
    const plan = buildHaSetupPlan({ timezone: '', country: '' });
    expect(plan.coreUpdate).toBeNull();
  });
});

describe('buildHaSetupPlan — floors + rooms', () => {
  it('maps floors to ordered plans with index-derived levels', () => {
    const input: HaSetupInput = {
      layout: {
        floors: [
          { name: 'Ground', rooms: [{ name: 'Living' }, { name: 'Kitchen' }] },
          { name: 'Upstairs', rooms: [{ name: 'Bedroom' }] },
        ],
      },
    };
    const plan = buildHaSetupPlan(input);
    expect(plan.floors).toEqual([
      { name: 'Ground', level: 0, rooms: [{ name: 'Living' }, { name: 'Kitchen' }] },
      { name: 'Upstairs', level: 1, rooms: [{ name: 'Bedroom' }] },
    ]);
  });

  it('keeps a floor with no rooms (e.g. attic)', () => {
    const plan = buildHaSetupPlan({ layout: { floors: [{ name: 'Attic', rooms: [] }] } });
    expect(plan.floors).toEqual([{ name: 'Attic', level: 0, rooms: [] }]);
  });

  it('returns an empty floor list when no layout is present', () => {
    const plan = buildHaSetupPlan({ latitude: 1 });
    expect(plan.floors).toEqual([]);
  });
});

describe('buildLayoutFromRegistries — device layout seed (#638)', () => {
  const floors: HaFloorRegistryEntry[] = [
    { floor_id: 'f-up', name: 'Upstairs', level: 1 },
    { floor_id: 'f-ground', name: 'Ground', level: 0 },
  ];
  const areas: HaAreaRegistryEntry[] = [
    { area_id: 'a-living', name: 'Living', floor_id: 'f-ground' },
    { area_id: 'a-kitchen', name: 'Kitchen', floor_id: 'f-ground' },
    { area_id: 'a-bed', name: 'Bedroom', floor_id: 'f-up' },
    { area_id: 'a-garage', name: 'Garage', floor_id: null },
    { area_id: 'a-attic', name: 'Attic' },
  ];

  it('groups areas under their floors, ordered by level', () => {
    const result = buildLayoutFromRegistries(floors, areas);
    expect(result.floors.map((f) => f.name)).toEqual(['Ground', 'Upstairs']);
    const ground = result.floors.find((f) => f.id === 'f-ground');
    expect(ground?.rooms.map((r) => r.name)).toEqual(['Living', 'Kitchen']);
    const up = result.floors.find((f) => f.id === 'f-up');
    expect(up?.rooms.map((r) => r.name)).toEqual(['Bedroom']);
  });

  it('collects floorless / unknown-floor areas as unassigned', () => {
    const result = buildLayoutFromRegistries(floors, areas);
    expect(result.unassigned.map((r) => r.name)).toEqual(['Garage', 'Attic']);
  });

  it('treats an area pointing at a missing floor as unassigned', () => {
    const result = buildLayoutFromRegistries(floors, [
      { area_id: 'a-x', name: 'Mystery', floor_id: 'f-nonexistent' },
    ]);
    expect(result.floors.flatMap((f) => f.rooms)).toEqual([]);
    expect(result.unassigned.map((r) => r.name)).toEqual(['Mystery']);
  });

  it('returns empty floors + unassigned for empty registries', () => {
    expect(buildLayoutFromRegistries([], [])).toEqual({ floors: [], unassigned: [] });
  });
});

describe('mapHaConfigResult — get_config → Home Overview seed (#646)', () => {
  it('narrows a full HA config into the wizard seed', () => {
    const seed = mapHaConfigResult({
      latitude: 39.6588,
      longitude: 27.9063,
      unit_system: { temperature: '°C', length: 'km' },
      time_zone: 'Europe/Istanbul',
      country: 'tr',
      currency: 'TRY',
      language: 'tr',
      location_name: 'Evim',
      // Extra fields HA returns are ignored.
      version: '2026.5.0',
    });
    expect(seed).toEqual({
      latitude: 39.6588,
      longitude: 27.9063,
      unitSystem: 'metric',
      timezone: 'Europe/Istanbul',
      country: 'TR',
      currency: 'TRY',
      language: 'tr',
      locationName: 'Evim',
    });
  });

  it('derives imperial from a Fahrenheit unit system', () => {
    expect(mapHaConfigResult({ unit_system: { temperature: '°F' } }).unitSystem).toBe('imperial');
  });

  it('omits fields HA did not report or reported unusable', () => {
    expect(
      mapHaConfigResult({
        latitude: 'nope',
        longitude: Number.NaN,
        country: 'turkey',
        currency: '',
        unit_system: { temperature: 'kelvin' },
      }),
    ).toEqual({});
  });

  it('returns an empty seed for a non-object result', () => {
    expect(mapHaConfigResult(null)).toEqual({});
    expect(mapHaConfigResult(undefined)).toEqual({});
    expect(mapHaConfigResult('x')).toEqual({});
  });
});

describe('buildLayoutReconcilePlan — desired vs existing registries (#652)', () => {
  const existing = {
    floors: [
      { id: 'f-ground', name: 'Ground', rooms: [{ id: 'a-living', name: 'Living' }] },
      { id: 'f-up', name: 'Upstairs', rooms: [{ id: 'a-bed', name: 'Bedroom' }] },
    ],
    unassigned: [{ id: 'a-garage', name: 'Garage' }],
  };

  it('is a no-op when desired matches existing (idempotent re-save)', () => {
    const plan = buildLayoutReconcilePlan(existing, {
      floors: [
        { id: 'f-ground', name: 'Ground', rooms: [{ id: 'a-living', name: 'Living' }] },
        { id: 'f-up', name: 'Upstairs', rooms: [{ id: 'a-bed', name: 'Bedroom' }] },
      ],
    });
    // a-garage is unassigned + absent from desired → it gets deleted; the
    // rest is unchanged.
    expect(plan.floorsToCreate).toEqual([]);
    expect(plan.floorsToUpdate).toEqual([]);
    expect(plan.floorIdsToDelete).toEqual([]);
    expect(plan.areasToCreate).toEqual([]);
    expect(plan.areasToUpdate).toEqual([]);
    expect(plan.areaIdsToDelete).toEqual(['a-garage']);
  });

  it('renames a floor and a room in place (no recreate)', () => {
    const plan = buildLayoutReconcilePlan(
      { floors: existing.floors, unassigned: [] },
      {
        floors: [
          { id: 'f-ground', name: 'Main', rooms: [{ id: 'a-living', name: 'Lounge' }] },
          { id: 'f-up', name: 'Upstairs', rooms: [{ id: 'a-bed', name: 'Bedroom' }] },
        ],
      },
    );
    expect(plan.floorsToUpdate).toEqual([{ floorId: 'f-ground', name: 'Main' }]);
    expect(plan.areasToUpdate).toEqual([{ areaId: 'a-living', name: 'Lounge' }]);
    expect(plan.floorsToCreate).toEqual([]);
    expect(plan.areaIdsToDelete).toEqual([]);
  });

  it('creates new floors/rooms (client-UUID ids) and threads the floor key', () => {
    const plan = buildLayoutReconcilePlan(
      { floors: [], unassigned: [] },
      { floors: [{ id: 'new-floor', name: 'Attic', rooms: [{ id: 'new-room', name: 'Studio' }] }] },
    );
    expect(plan.floorsToCreate).toEqual([{ key: 'new-floor', name: 'Attic', level: 0 }]);
    expect(plan.areasToCreate).toEqual([
      { name: 'Studio', floor: { kind: 'new', key: 'new-floor' } },
    ]);
  });

  it('deletes floors and rooms the user removed', () => {
    const plan = buildLayoutReconcilePlan(existing, {
      floors: [{ id: 'f-ground', name: 'Ground', rooms: [{ id: 'a-living', name: 'Living' }] }],
    });
    expect(plan.floorIdsToDelete).toEqual(['f-up']);
    expect([...plan.areaIdsToDelete].sort()).toEqual(['a-bed', 'a-garage']);
  });

  it('reparents a formerly-unassigned area under a newly-created floor', () => {
    const plan = buildLayoutReconcilePlan(existing, {
      floors: [
        { id: 'f-ground', name: 'Ground', rooms: [{ id: 'a-living', name: 'Living' }] },
        { id: 'f-up', name: 'Upstairs', rooms: [{ id: 'a-bed', name: 'Bedroom' }] },
        // Synthetic floor the UI created for the unassigned Garage.
        { id: 'f-new', name: 'Ground Floor', rooms: [{ id: 'a-garage', name: 'Garage' }] },
      ],
    });
    expect(plan.floorsToCreate).toEqual([{ key: 'f-new', name: 'Ground Floor', level: 2 }]);
    expect(plan.areasToUpdate).toEqual([
      { areaId: 'a-garage', floor: { kind: 'new', key: 'f-new' } },
    ]);
    expect(plan.areaIdsToDelete).toEqual([]);
  });

  it('reparents an area moved between two existing floors', () => {
    const plan = buildLayoutReconcilePlan(
      { floors: existing.floors, unassigned: [] },
      {
        floors: [
          { id: 'f-ground', name: 'Ground', rooms: [] },
          {
            id: 'f-up',
            name: 'Upstairs',
            rooms: [
              { id: 'a-bed', name: 'Bedroom' },
              { id: 'a-living', name: 'Living' },
            ],
          },
        ],
      },
    );
    expect(plan.areasToUpdate).toEqual([
      { areaId: 'a-living', floor: { kind: 'existing', floorId: 'f-up' } },
    ]);
  });
});

describe('mapHomeZoneRadius — zone.home radius from get_states (#678)', () => {
  it('extracts a numeric radius from the zone.home entity', () => {
    const states = [
      { entity_id: 'sun.sun', attributes: {} },
      { entity_id: 'zone.home', attributes: { radius: 250, latitude: 41 } },
    ];
    expect(mapHomeZoneRadius(states)).toBe(250);
  });

  it('returns undefined when zone.home is absent', () => {
    expect(
      mapHomeZoneRadius([{ entity_id: 'zone.work', attributes: { radius: 50 } }]),
    ).toBeUndefined();
  });

  it('returns undefined for a non-numeric / missing radius', () => {
    expect(
      mapHomeZoneRadius([{ entity_id: 'zone.home', attributes: { radius: 'x' } }]),
    ).toBeUndefined();
    expect(mapHomeZoneRadius([{ entity_id: 'zone.home', attributes: {} }])).toBeUndefined();
  });

  it('never throws on odd input', () => {
    expect(mapHomeZoneRadius(null)).toBeUndefined();
    expect(mapHomeZoneRadius('nope')).toBeUndefined();
    expect(mapHomeZoneRadius([null, 3, 'x'])).toBeUndefined();
  });
});
