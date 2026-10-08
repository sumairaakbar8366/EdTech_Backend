import { formatDateOnly, isDateOnly, toDateOnly } from './date-only.js';

describe('date-only helpers', () => {
  it('accepts real calendar dates only', () => {
    expect(isDateOnly('2026-04-01')).toBe(true);
    expect(isDateOnly('2028-02-29')).toBe(true);
    expect(isDateOnly('2026-02-29')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-4-1')).toBe(false);
    expect(isDateOnly('2026-04-01T00:00:00Z')).toBe(false);
    expect(isDateOnly(20260401)).toBe(false);
  });

  it('round-trips through UTC midnight', () => {
    expect(toDateOnly('2026-04-01').toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(formatDateOnly(toDateOnly('2026-12-31'))).toBe('2026-12-31');
  });
});
