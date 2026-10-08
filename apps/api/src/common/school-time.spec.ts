import { isoWeekday, schoolClock, toHHMM, toMinutes } from './school-time.js';

describe('schoolClock', () => {
  it('uses the school timezone, not the server', () => {
    // 2026-10-01 20:30 UTC is already Friday 2026-10-02 01:30 in Karachi (UTC+5).
    const at = new Date('2026-10-01T20:30:00Z');
    expect(schoolClock('Asia/Karachi', at)).toEqual({ date: '2026-10-02', dayOfWeek: 5, minute: 90 });
    expect(schoolClock('UTC', at)).toEqual({ date: '2026-10-01', dayOfWeek: 4, minute: 1230 });
  });

  it('reports midnight as minute 0', () => {
    expect(schoolClock('UTC', new Date('2026-10-04T00:00:00Z')).minute).toBe(0);
  });
});

describe('time helpers', () => {
  it('computes ISO weekdays', () => {
    expect(isoWeekday('2026-10-05')).toBe(1); // Monday
    expect(isoWeekday('2026-10-04')).toBe(7); // Sunday
  });

  it('converts HH:MM and minutes both ways', () => {
    expect(toMinutes('08:30')).toBe(510);
    expect(toHHMM(510)).toBe('08:30');
    expect(toHHMM(0)).toBe('00:00');
  });
});
