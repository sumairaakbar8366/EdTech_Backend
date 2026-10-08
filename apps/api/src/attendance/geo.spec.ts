import { distanceMeters, evaluateGeofence, workingDays } from './geo.js';

describe('distanceMeters', () => {
  it('matches known distances', () => {
    // One degree of latitude on a 6,371 km sphere = pi/180 * 6,371,000 m = 111,194.9 m
    expect(distanceMeters(0, 0, 1, 0)).toBeCloseTo(111_194.9, 0);
    // One degree of longitude at 60 degrees latitude is half that
    expect(distanceMeters(60, 0, 60, 1)).toBeCloseTo(55_596.0, -1);
    expect(distanceMeters(31.5, 74.3, 31.5, 74.3)).toBe(0);
  });
});

describe('evaluateGeofence', () => {
  const fence = { latitude: 31.5204, longitude: 74.3587, radiusMeters: 150 };

  it('is valid inside the radius', () => {
    expect(evaluateGeofence({ latitude: 31.5205, longitude: 74.3588 }, fence).status).toBe('valid');
  });

  it('is flagged outside the radius and reports the distance', () => {
    const r = evaluateGeofence({ latitude: 31.53, longitude: 74.36 }, fence);
    expect(r.status).toBe('flagged');
    expect(r.distance).toBeGreaterThan(150);
  });

  it('is unknown without GPS or without a geofence', () => {
    expect(evaluateGeofence(null, fence)).toEqual({ status: 'unknown', distance: null });
    expect(evaluateGeofence({ latitude: 31.52, longitude: 74.35 }, null)).toEqual({ status: 'unknown', distance: null });
  });
});

describe('workingDays', () => {
  it('skips weekly off-days', () => {
    // Thu 2026-10-01 .. Mon 2026-10-05, Sunday off → Thu, Fri, Sat, Mon
    expect(workingDays('2026-10-01', '2026-10-05', [7])).toBe(4);
    expect(workingDays('2026-10-01', '2026-10-05', [6, 7])).toBe(3);
    expect(workingDays('2026-10-04', '2026-10-04', [7])).toBe(0);
    expect(workingDays('2026-10-05', '2026-10-05', [])).toBe(1);
  });
});
