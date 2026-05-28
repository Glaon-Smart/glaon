import { describe, expect, it } from 'vitest';

import { buildHaSetupPlan, type HaSetupInput } from './setup-commands';

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
