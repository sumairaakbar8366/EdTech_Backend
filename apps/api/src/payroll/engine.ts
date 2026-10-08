/**
 * Payroll calculation engine (page 9). Pure: the service loads the inputs, this computes the pay.
 * All amounts are integer minor units (see fees/money.ts). Attendance and leave are inputs only;
 * they never touch a salary directly ("Attendance → Payroll Calculation Engine → Payroll Record").
 *
 *   gross  = basic + allowances (+ bonus, added during review)
 *   daily  = gross / working days in the period
 *   net    = gross − absence deduction − unpaid-leave deduction − component deductions − manual
 */

export interface ComponentIn {
  kind: 'earning' | 'deduction';
  name: string;
  calc: 'fixed' | 'percent_of_basic';
  /** fixed: minor units; percent_of_basic: basis points (10% = 1000). */
  value: number;
}

export interface EngineInput {
  periodStart: string;
  periodEnd: string;
  /** School-local today; days after it are never counted as absences. */
  today: string;
  /** ISO weekdays the school is closed (1 = Monday … 7 = Sunday). */
  offDays: readonly number[];
  applyAttendance: boolean;
  joinDate: string;
  basic: number;
  components: readonly ComponentIn[];
  /** Working dates with an accepted check-in. */
  presentDates: ReadonlySet<string>;
  /** Approved leave ranges (inclusive). */
  leaves: readonly { start: string; end: string; isPaid: boolean }[];
}

export interface DeductionOut {
  type: 'attendance' | 'leave' | 'component';
  label: string;
  amount: number;
}

export interface EngineOutput {
  basic: number;
  allowances: number;
  earnings: { name: string; amount: number }[];
  gross: number;
  workingDays: number;
  payableDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  notEmployedDays: number;
  deductions: DeductionOut[];
  attendanceDeduction: number;
  leaveDeduction: number;
  otherDeductions: number;
}

/** Inclusive list of YYYY-MM-DD dates in a range that are not weekly off-days. */
export function workingDates(start: string, end: string, offDays: readonly number[]): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (!offDays.includes(iso)) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const pct = (base: number, bp: number) => Math.round((base * bp) / 10_000);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function calculatePay(input: EngineInput): EngineOutput {
  const dates = workingDates(input.periodStart, input.periodEnd, input.offDays);
  const wd = dates.length;
  if (wd === 0) throw new Error('The period has no working days');

  const earnings = [
    { name: 'Basic salary', amount: input.basic },
    ...input.components
      .filter((c) => c.kind === 'earning')
      .map((c) => ({ name: c.name, amount: c.calc === 'fixed' ? c.value : pct(input.basic, c.value) })),
  ];
  const allowances = earnings.slice(1).reduce((s, e) => s + e.amount, 0);
  const gross = input.basic + allowances;
  const share = (days: number) => Math.round((gross * days) / wd);

  let notEmployed = 0;
  let present = 0;
  let paidLeave = 0;
  let unpaidLeave = 0;
  let absent = 0;
  for (const date of dates) {
    if (date < input.joinDate) {
      notEmployed++;
      continue;
    }
    if (input.presentDates.has(date)) {
      present++;
      continue;
    }
    const leave = input.leaves.find((l) => l.start <= date && date <= l.end);
    if (leave) {
      if (leave.isPaid) paidLeave++;
      else unpaidLeave++;
      continue;
    }
    if (input.applyAttendance && date <= input.today) absent++;
  }

  const deductions: DeductionOut[] = [];
  if (notEmployed > 0) deductions.push({ type: 'attendance', label: `Not yet employed: ${plural(notEmployed, 'working day')}`, amount: share(notEmployed) });
  if (absent > 0) deductions.push({ type: 'attendance', label: `Absent without leave: ${plural(absent, 'day')}`, amount: share(absent) });
  if (unpaidLeave > 0) deductions.push({ type: 'leave', label: `Unpaid leave: ${plural(unpaidLeave, 'day')}`, amount: share(unpaidLeave) });
  for (const c of input.components.filter((x) => x.kind === 'deduction')) {
    const amount = c.calc === 'fixed' ? c.value : pct(input.basic, c.value);
    if (amount > 0) deductions.push({ type: 'component', label: c.name, amount });
  }
  const sum = (type: DeductionOut['type']) => deductions.filter((d) => d.type === type).reduce((s, d) => s + d.amount, 0);

  return {
    basic: input.basic,
    allowances,
    earnings,
    gross,
    workingDays: wd,
    payableDays: wd - notEmployed - absent - unpaidLeave,
    presentDays: present,
    paidLeaveDays: paidLeave,
    unpaidLeaveDays: unpaidLeave,
    absentDays: absent,
    notEmployedDays: notEmployed,
    deductions,
    attendanceDeduction: sum('attendance'),
    leaveDeduction: sum('leave'),
    otherDeductions: sum('component'),
  };
}

/** Net pay after review adjustments; never negative. */
export function netPay(gross: number, bonus: number, totalDeductions: number): number {
  return Math.max(0, gross + bonus - totalDeductions);
}
