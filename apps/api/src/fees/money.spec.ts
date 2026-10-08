import { allocateOldestFirst, applyConcessions, deriveStatus, fromMinor, toMinor } from './money.js';

describe('toMinor / fromMinor', () => {
  it('parses without floating point error', () => {
    expect(toMinor('0.1')).toBe(10);
    expect(toMinor('1234.5')).toBe(123450);
    expect(toMinor('1234.56')).toBe(123456);
    expect(toMinor(19.99)).toBe(1999);
    expect(toMinor('-5.05')).toBe(-505);
    expect(() => toMinor('1.234')).toThrow();
    expect(() => toMinor('abc')).toThrow();
  });

  it('formats minor units', () => {
    expect(fromMinor(123450)).toBe('1234.50');
    expect(fromMinor(5)).toBe('0.05');
    expect(fromMinor(-505)).toBe('-5.05');
    expect(fromMinor(toMinor('0.1') + toMinor('0.2'))).toBe('0.30');
  });
});

describe('applyConcessions', () => {
  const lines = [
    { key: 'tuition', categoryId: 'TUI', amount: 500000 }, // 5,000.00
    { key: 'lab', categoryId: 'LAB', amount: 100000 }, // 1,000.00
  ];

  it('applies a percentage to matching categories only', () => {
    const d = applyConcessions(lines, [{ valueType: 'percentage', value: 1000, categoryId: 'TUI' }]); // 10% tuition
    expect(d.get('tuition')).toBe(50000);
    expect(d.get('lab')).toBe(0);
  });

  it('applies a school-wide percentage to every line', () => {
    const d = applyConcessions(lines, [{ valueType: 'percentage', value: 1250, categoryId: null }]); // 12.5%
    expect(d.get('tuition')).toBe(62500);
    expect(d.get('lab')).toBe(12500);
  });

  it('spreads a fixed amount and caps at the line amount', () => {
    const d = applyConcessions(lines, [{ valueType: 'fixed', value: 550000, categoryId: null }]);
    expect(d.get('tuition')).toBe(500000);
    expect(d.get('lab')).toBe(50000);
  });

  it('never discounts more than 100% when stacking', () => {
    const d = applyConcessions(lines, [
      { valueType: 'percentage', value: 8000, categoryId: 'TUI' },
      { valueType: 'percentage', value: 5000, categoryId: 'TUI' },
      { valueType: 'fixed', value: 999999, categoryId: 'TUI' },
    ]);
    expect(d.get('tuition')).toBe(500000);
  });
});

describe('deriveStatus', () => {
  it('follows page 8 statuses', () => {
    expect(deriveStatus(1000, 0, '2026-10-10', '2026-10-01')).toBe('pending');
    expect(deriveStatus(1000, 400, '2026-10-10', '2026-10-01')).toBe('partial');
    expect(deriveStatus(1000, 1000, '2026-09-01', '2026-10-01')).toBe('paid');
    expect(deriveStatus(1000, 400, '2026-09-30', '2026-10-01')).toBe('overdue');
    expect(deriveStatus(1000, 0, '2026-10-01', '2026-10-01')).toBe('pending'); // due today is not overdue
  });
});

describe('allocateOldestFirst', () => {
  it('pays the oldest invoices first', () => {
    const open = [{ key: 'sep', balance: 3000 }, { key: 'oct', balance: 5000 }, { key: 'nov', balance: 5000 }];
    expect(allocateOldestFirst(6000, open)).toEqual([['sep', 3000], ['oct', 3000]]);
    expect(allocateOldestFirst(13000, open)).toEqual([['sep', 3000], ['oct', 5000], ['nov', 5000]]);
  });
});
