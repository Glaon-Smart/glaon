import { describe, expect, it } from 'vitest';

import { circlePolygon, destinationPoint, haversineMeters, type LatLng } from './geo';

const ISTANBUL: LatLng = { lat: 41.0082, lng: 28.9784 };

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(ISTANBUL, ISTANBUL)).toBeCloseTo(0, 5);
  });

  it('measures a known short distance within tolerance', () => {
    // ~1 km north of Istanbul (0.009° lat ≈ 1001 m).
    const north: LatLng = { lat: ISTANBUL.lat + 0.009, lng: ISTANBUL.lng };
    expect(haversineMeters(ISTANBUL, north)).toBeGreaterThan(950);
    expect(haversineMeters(ISTANBUL, north)).toBeLessThan(1050);
  });

  it('is symmetric', () => {
    const b: LatLng = { lat: 39.9334, lng: 32.8597 };
    expect(haversineMeters(ISTANBUL, b)).toBeCloseTo(haversineMeters(b, ISTANBUL), 3);
  });
});

describe('destinationPoint', () => {
  it('round-trips with haversine: a point R metres away is R metres away', () => {
    const handle = destinationPoint(ISTANBUL, 200, 90);
    expect(haversineMeters(ISTANBUL, handle)).toBeCloseTo(200, 0);
  });

  it('heading east increases longitude, keeps latitude roughly equal', () => {
    const east = destinationPoint(ISTANBUL, 500, 90);
    expect(east.lng).toBeGreaterThan(ISTANBUL.lng);
    expect(east.lat).toBeCloseTo(ISTANBUL.lat, 3);
  });

  it('heading north increases latitude', () => {
    const north = destinationPoint(ISTANBUL, 500, 0);
    expect(north.lat).toBeGreaterThan(ISTANBUL.lat);
  });
});

describe('circlePolygon', () => {
  it('returns a closed ring with steps+1 coordinates', () => {
    const feature = circlePolygon(ISTANBUL, 200, 32);
    const ring = feature.geometry.coordinates[0];
    expect(ring).toHaveLength(33);
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
  });

  it('every vertex sits ~radius metres from the centre', () => {
    const feature = circlePolygon(ISTANBUL, 200, 16);
    for (const pos of feature.geometry.coordinates[0] ?? []) {
      const [lng, lat] = pos as [number, number];
      expect(haversineMeters(ISTANBUL, { lat, lng })).toBeCloseTo(200, 0);
    }
  });

  it('clamps a negative radius to zero', () => {
    const feature = circlePolygon(ISTANBUL, -50, 8);
    for (const pos of feature.geometry.coordinates[0] ?? []) {
      const [lng, lat] = pos as [number, number];
      expect(haversineMeters(ISTANBUL, { lat, lng })).toBeCloseTo(0, 1);
    }
  });
});
