import { describe, expect, it } from 'vitest';
import { changePercent, periodBounds, verdict, type Snapshot } from './school-snapshot.js';

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ students: 100, newStudents: 0, teachers: 10, staff: 5, attendancePercent: 90, collected: 1000, billed: 1000, outstanding: 0, salaries: 400, admissions: 0, surplus: 600, ...o });

describe('periods', () => {
  it('finds the month and year around a date', () => {
    const m = periodBounds('month', new Date('2026-10-28T10:00:00Z'));
    expect(m.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(m.to.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(m.previousFrom.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(m.label).toBe('October 2026');
    const jan = periodBounds('month', new Date('2026-01-15T00:00:00Z'));
    expect(jan.previousFrom.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(periodBounds('year', new Date('2026-10-28T00:00:00Z')).to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('change and verdict', () => {
  it('computes percent change and copes with zero', () => {
    expect(changePercent(110, 100)).toBe(10);
    expect(changePercent(90, 100)).toBe(-10);
    expect(changePercent(0, 0)).toBe(0);
    expect(changePercent(5, 0)).toBeNull();
  });
  it('calls a school growing, steady or declining', () => {
    const none = { raised: 0, resolved: 0, open: 0 };
    expect(verdict(snap({ students: 110, collected: 1200 }), snap(), none).status).toBe('growing');
    expect(verdict(snap(), snap(), none).status).toBe('steady');
    expect(verdict(snap({ students: 90, collected: 800 }), snap(), { raised: 5, resolved: 1, open: 4 }).status).toBe('declining');
  });
  it('explains itself and flags a deficit', () => {
    const v = verdict(snap({ collected: 300, surplus: -100 }), snap(), { raised: 2, resolved: 2, open: 0 });
    expect(v.reasons.join(' ')).toMatch(/Fees received fell/);
    expect(v.reasons.join(' ')).toMatch(/Salaries paid were more/);
    expect(v.reasons.join(' ')).toMatch(/Every complaint/);
  });
});
