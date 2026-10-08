import { BadRequestException } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import { assertValidRange, rangeContains, rangesOverlap } from './date-rules.js';

const r = (start: string, end: string) => ({ startDate: toDateOnly(start), endDate: toDateOnly(end) });

describe('academic date rules', () => {
  it('treats ranges as inclusive when checking overlap', () => {
    expect(rangesOverlap(r('2026-04-01', '2027-03-31'), r('2027-03-31', '2028-03-30'))).toBe(true);
    expect(rangesOverlap(r('2026-04-01', '2027-03-31'), r('2027-04-01', '2028-03-31'))).toBe(false);
    expect(rangesOverlap(r('2026-01-01', '2026-12-31'), r('2026-06-01', '2026-06-30'))).toBe(true);
  });

  it('checks containment of terms inside a year', () => {
    const year = r('2026-04-01', '2027-03-31');
    expect(rangeContains(year, r('2026-04-01', '2026-09-30'))).toBe(true);
    expect(rangeContains(year, r('2026-03-31', '2026-09-30'))).toBe(false);
    expect(rangeContains(year, r('2026-10-01', '2027-04-01'))).toBe(false);
  });

  it('rejects ranges that do not move forward', () => {
    expect(() => assertValidRange(r('2026-04-01', '2026-04-01'), 'Term')).toThrow(BadRequestException);
    expect(() => assertValidRange(r('2026-04-02', '2026-04-01'), 'Term')).toThrow(BadRequestException);
    expect(() => assertValidRange(r('2026-04-01', '2026-04-02'), 'Term')).not.toThrow();
  });
});
