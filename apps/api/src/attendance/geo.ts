const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two WGS84 points (haversine). */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type GeofenceStatus = 'valid' | 'flagged' | 'unknown';

/**
 * Page 7 "Geofence Validation Engine":
 * - no GPS fix (permission denied / unavailable) or no geofence configured → unknown
 * - device within the campus radius → valid
 * - otherwise → flagged (admin review required)
 */
export function evaluateGeofence(
  position: { latitude: number; longitude: number } | null,
  fence: { latitude: number; longitude: number; radiusMeters: number } | null,
): { status: GeofenceStatus; distance: number | null } {
  if (!position || !fence) return { status: 'unknown', distance: null };
  const distance = Math.round(distanceMeters(position.latitude, position.longitude, fence.latitude, fence.longitude));
  return { status: distance <= fence.radiusMeters ? 'valid' : 'flagged', distance };
}

/** Working days in an inclusive YYYY-MM-DD range, skipping the given ISO weekdays. */
export function workingDays(start: string, end: string, offDays: readonly number[]): number {
  let count = 0;
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (!offDays.includes(iso)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}
