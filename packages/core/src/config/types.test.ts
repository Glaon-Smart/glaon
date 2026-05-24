import { describe, expect, it } from 'vitest';

import {
  DEVICE_CONFIG_SCHEMA_VERSION,
  DeviceConfigSchema,
  FloorSchema,
  LayoutSchema,
  RoomSchema,
  RoomTypeSchema,
  UnitSystemSchema,
  WifiConfigSchema,
} from './types';

describe('DeviceConfigSchema', () => {
  it('accepts a bare blob with only schemaVersion', () => {
    const parsed = DeviceConfigSchema.parse({ schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION });
    expect(parsed).toEqual({ schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION });
  });

  it('accepts a full blob with every field populated', () => {
    const blob = {
      schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
      homeName: 'Olivia',
      location: 'Istanbul, TR',
      latitude: 41.0082,
      longitude: 28.9784,
      country: 'TR',
      timezone: 'Europe/Istanbul',
      locale: 'tr-TR',
      unitSystem: 'metric',
      layout: {
        floors: [
          {
            id: 'floor-1',
            name: 'Zemin Kat',
            rooms: [
              { id: 'room-1', name: 'Salon', type: 'living' as const },
              { id: 'room-2', name: 'Mutfak', type: 'kitchen' as const },
            ],
          },
          {
            id: 'floor-2',
            name: '1. Kat',
            rooms: [{ id: 'room-3', name: 'Yatak Odası', type: 'bedroom' as const }],
          },
        ],
      },
      wifi: { ssid: 'home', passwordCipher: 'AES-GCM:abc123' },
      securityPinHash: 'a'.repeat(64),
      completedAt: '2026-05-17T18:30:00.000Z',
    } as const;
    expect(DeviceConfigSchema.parse(blob)).toEqual(blob);
  });

  it('rejects latitude outside [-90, 90]', () => {
    expect(() =>
      DeviceConfigSchema.parse({ schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION, latitude: 95 }),
    ).toThrow();
    expect(() =>
      DeviceConfigSchema.parse({ schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION, latitude: -91 }),
    ).toThrow();
  });

  it('rejects longitude outside [-180, 180]', () => {
    expect(() =>
      DeviceConfigSchema.parse({ schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION, longitude: 200 }),
    ).toThrow();
    expect(() =>
      DeviceConfigSchema.parse({ schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION, longitude: -181 }),
    ).toThrow();
  });

  it('rejects an unrecognised schemaVersion', () => {
    expect(() => DeviceConfigSchema.parse({ schemaVersion: 2 })).toThrow();
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(() =>
      DeviceConfigSchema.parse({
        schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
        someFutureField: true,
      }),
    ).toThrow();
  });

  it('rejects a lowercase country code', () => {
    expect(() =>
      DeviceConfigSchema.parse({ schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION, country: 'tr' }),
    ).toThrow(/ISO 3166-1/);
  });

  it('rejects a non-2-letter country code', () => {
    expect(() =>
      DeviceConfigSchema.parse({ schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION, country: 'USA' }),
    ).toThrow();
  });

  it('rejects a securityPinHash that is not 64 lowercase hex chars', () => {
    expect(() =>
      DeviceConfigSchema.parse({
        schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
        securityPinHash: 'too short',
      }),
    ).toThrow(/SHA-256 hex/);
    expect(() =>
      DeviceConfigSchema.parse({
        schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
        securityPinHash: 'A'.repeat(64),
      }),
    ).toThrow(/SHA-256 hex/);
  });

  it('rejects an invalid completedAt timestamp', () => {
    expect(() =>
      DeviceConfigSchema.parse({
        schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
        completedAt: 'not-a-date',
      }),
    ).toThrow();
  });

  it('rejects wifi with an empty ssid or empty passwordCipher', () => {
    expect(() =>
      DeviceConfigSchema.parse({
        schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
        wifi: { ssid: '', passwordCipher: 'x' },
      }),
    ).toThrow();
    expect(() =>
      DeviceConfigSchema.parse({
        schemaVersion: DEVICE_CONFIG_SCHEMA_VERSION,
        wifi: { ssid: 'home', passwordCipher: '' },
      }),
    ).toThrow();
  });
});

describe('LayoutSchema', () => {
  const baseRoom = { id: 'r-1', name: 'Living', type: 'living' as const };
  const baseFloor = { id: 'f-1', name: 'Ground Floor', rooms: [baseRoom] };

  it('accepts a single-floor / single-room blob', () => {
    expect(LayoutSchema.parse({ floors: [baseFloor] })).toEqual({ floors: [baseFloor] });
  });

  it('accepts an empty rooms array (attic etc.)', () => {
    expect(LayoutSchema.parse({ floors: [{ id: 'f-1', name: 'Attic', rooms: [] }] })).toBeDefined();
  });

  it('rejects zero floors', () => {
    expect(() => LayoutSchema.parse({ floors: [] })).toThrow();
  });

  it('rejects more than 10 floors', () => {
    const eleven = Array.from({ length: 11 }, (_, idx) => ({
      ...baseFloor,
      id: `f-${idx.toString()}`,
    }));
    expect(() => LayoutSchema.parse({ floors: eleven })).toThrow();
  });

  it('rejects an empty floor name', () => {
    expect(() => FloorSchema.parse({ ...baseFloor, name: '' })).toThrow();
  });

  it('rejects more than 50 rooms on a floor', () => {
    const tooMany = Array.from({ length: 51 }, (_, idx) => ({
      ...baseRoom,
      id: `r-${idx.toString()}`,
    }));
    expect(() => FloorSchema.parse({ ...baseFloor, rooms: tooMany })).toThrow();
  });

  it('rejects an empty room name', () => {
    expect(() => RoomSchema.parse({ ...baseRoom, name: '' })).toThrow();
  });

  it('rejects a room type not in the enum', () => {
    expect(() => RoomTypeSchema.parse('basement')).toThrow();
  });
});

describe('UnitSystemSchema', () => {
  it('accepts metric and imperial', () => {
    expect(UnitSystemSchema.parse('metric')).toBe('metric');
    expect(UnitSystemSchema.parse('imperial')).toBe('imperial');
  });

  it('rejects anything else', () => {
    expect(() => UnitSystemSchema.parse('si')).toThrow();
  });
});

describe('WifiConfigSchema', () => {
  it('round-trips a populated wifi entry', () => {
    expect(WifiConfigSchema.parse({ ssid: 'home', passwordCipher: 'x' })).toEqual({
      ssid: 'home',
      passwordCipher: 'x',
    });
  });
});
