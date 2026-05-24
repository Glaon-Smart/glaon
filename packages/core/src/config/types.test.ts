import { describe, expect, it } from 'vitest';

import {
  DEVICE_CONFIG_SCHEMA_VERSION,
  DeviceConfigSchema,
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
      layout: 'open-plan, 2 katlı',
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
