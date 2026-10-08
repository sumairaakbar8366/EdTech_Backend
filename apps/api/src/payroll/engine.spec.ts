import { describe, expect, it } from 'vitest';
import { calculatePay, netPay, workingDates, type EngineInput } from './engine.js';

// October 2026: 1st is a Thursday. With Sunday off there are 27 working days.
const base: EngineInput = {
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  today: '2026-10-31',
  offDays: [7],
  applyAttendance: true,
  joinDate: '2020-01-01',
  basic: 2_700_000, // 27,000.00
  components: [],
  presentDates: new Set(workingDates('2026-10-01', '2026-10-31', [7])),
  leaves: [],
};

describe('workingDates', () => {
  it('skips weekly off-days', () => {
    expect(workingDates('2026-10-01', '2026-10-31', [7])).toHaveLength(27);
    expect(workingDates('2026-10-01', '2026-10-31', [6, 7])).toHaveLength(22);
  });
});

describe('calculatePay', () => {
  it('pays full gross with perfect attendance', () => {
    const r = calculatePay(base);
    expect(r.gross).toBe(2_700_000);
    expect(r.deductions).toEqual([]);
    expect(r.payableDays).toBe(27);
  });

  it('adds fixed and percentage allowances and deductions', () => {
    const r = calculatePay({
      ...base,
      components: [
        { kind: 'earning', name: 'House rent', calc: 'percent_of_basic', value: 1000 },
        { kind: 'earning', name: 'Transport', calc: 'fixed', value: 300_000 },
        { kind: 'deduction', name: 'Provident fund', calc: 'percent_of_basic', value: 500 },
      ],
    });
    expect(r.allowances).toBe(270_000 + 300_000);
    expect(r.gross).toBe(3_270_000);
    expect(r.otherDeductions).toBe(135_000);
  });

  it('deducts a daily rate for absences up to today only', () => {
    const present = new Set([...base.presentDates].filter((d) => d !== '2026-10-05' && d !== '2026-10-06' && d !== '2026-10-30'));
    const r = calculatePay({ ...base, presentDates: present, today: '2026-10-29' });
    expect(r.absentDays).toBe(2); // the 30th is after "today"
    expect(r.attendanceDeduction).toBe(200_000); // 27,000 / 27 × 2
  });

  it('does not deduct absences when attendance is not applied', () => {
    const r = calculatePay({ ...base, presentDates: new Set(), applyAttendance: false });
    expect(r.absentDays).toBe(0);
    expect(r.attendanceDeduction).toBe(0);
  });

  it('treats paid leave as payable and unpaid leave as a leave deduction', () => {
    const present = new Set([...base.presentDates].filter((d) => d < '2026-10-12' || d > '2026-10-17'));
    const r = calculatePay({
      ...base,
      presentDates: present,
      leaves: [
        { start: '2026-10-12', end: '2026-10-14', isPaid: true },
        { start: '2026-10-15', end: '2026-10-17', isPaid: false },
      ],
    });
    expect(r.paidLeaveDays).toBe(3);
    expect(r.unpaidLeaveDays).toBe(3);
    expect(r.absentDays).toBe(0);
    expect(r.leaveDeduction).toBe(300_000);
  });

  it('prorates an employee who joined mid-period', () => {
    const r = calculatePay({ ...base, joinDate: '2026-10-15' });
    expect(r.notEmployedDays).toBe(12); // 1–14 Oct minus two Sundays
    expect(r.attendanceDeduction).toBe(1_200_000);
    expect(r.payableDays).toBe(15);
  });

  it('rejects a period with no working days', () => {
    expect(() => calculatePay({ ...base, periodStart: '2026-10-04', periodEnd: '2026-10-04' })).toThrow();
  });
});

describe('netPay', () => {
  it('never goes below zero', () => {
    expect(netPay(1000, 0, 5000)).toBe(0);
    expect(netPay(1000, 500, 300)).toBe(1200);
  });
});
