import { describe, expect, it } from 'vitest';

import type { HaAreaRegistryEntry, HaFloorRegistryEntry } from './protocol/messages';
import {
  buildHaSetupPlan,
  buildLayoutFromRegistries,
  mapHaConfigResult,
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
      locale: 'tr',
    };
    const plan = buildHaSetupPlan(input);
    expect(plan.coreUpdate).toEqual({
      latitude: 41.0082,
      longitude: 28.9784,
      unit_system: 'metric',
      time_zone: 'Europe/Istanbul',
      country: 'TR',
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
