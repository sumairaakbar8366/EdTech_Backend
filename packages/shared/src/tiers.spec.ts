import { describe, expect, it } from 'vitest';
import { addMonthsUtc, trialPeriod } from './tiers.js';

describe('addMonthsUtc', () => {
  it('adds a calendar month', () => {
    expect(addMonthsUtc(new Date('2026-10-01T09:30:00Z'), 1).toISOString()).toBe('2026-11-01T09:30:00.000Z');
  });

  it('clamps to the end of shorter months', () => {
    expect(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsUtc(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('rolls over the year', () => {
    expect(addMonthsUtc(new Date('2026-12-15T00:00:00Z'), 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('trialPeriod', () => {
  it('lasts one month from the start', () => {
    const start = new Date('2026-10-01T00:00:00Z');
    expect(trialPeriod(start)).toEqual({ trialStartsAt: start, trialEndsAt: new Date('2026-11-01T00:00:00Z') });
  });
});
