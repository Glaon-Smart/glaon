// LocationPicker geo helpers (#647). Pure WGS84 math for the radius
// affordance: render a circle of N metres around the home marker, place a
// draggable handle on its edge, and convert a dragged handle position back
// into a radius. No map/DOM dependency so it unit-tests without MapLibre.

export interface LatLng {
  lat: number;
  lng: number;
}

// IUGG mean Earth radius (metres). The circle is a visual affordance, not
// a survey instrument, so the mean radius is plenty accurate.
const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Great-circle distance between two points, in metres (haversine).
 * Used to turn a dragged radius-handle position back into a radius.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Destination point reached from `origin` after travelling
 * `distanceMeters` along the given compass `bearingDeg` (0 = north,
 * 90 = east). Used to drop the radius handle on the circle's edge.
 */
export function destinationPoint(
  origin: LatLng,
  distanceMeters: number,
  bearingDeg: number,
): LatLng {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lng: normalizeLng(toDeg(lng2)) };
}

/**
 * GeoJSON polygon approximating a circle of `radiusMeters` around
 * `center`, as `steps` segments. Fed to a MapLibre GeoJSON source so the
 * circle scales correctly with zoom (a pixel-radius `circle` layer would
 * not). Returns a closed ring (first point repeated).
 */
export function circlePolygon(
  center: LatLng,
  radiusMeters: number,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const safeRadius = Math.max(0, radiusMeters);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 360;
    const point = destinationPoint(center, safeRadius, bearing);
    ring.push([point.lng, point.lat]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

/** Wrap a longitude into the [-180, 180] range after great-circle math. */
function normalizeLng(lng: number): number {
  return ((lng + 540) % 360) - 180;
}
