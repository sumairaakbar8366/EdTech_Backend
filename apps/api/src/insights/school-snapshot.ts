import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const num = (v: unknown) => (v == null ? 0 : Number(v));

export interface Snapshot {
  students: number;
  newStudents: number;
  teachers: number;
  staff: number;
  attendancePercent: number | null;
  /** Fees received in the period. */
  collected: number;
  /** Fees billed (invoices issued) in the period. */
  billed: number;
  /** Everything still owed by families, whenever it was billed. */
  outstanding: number;
  /** Salaries paid in the period. */
  salaries: number;
  admissions: number;
  /** Fees received minus salaries paid: what is left before other running costs, which the system does not track. */
  surplus: number;
}

/** A school's key figures for a period: one query set shared by the principal's report and the owner's view. */
export async function schoolSnapshot(prisma: PrismaService, schoolId: string, from: Date, to: Date): Promise<Snapshot> {
  return prisma.inSchoolTransaction(schoolId, async (tx) => {
    const [students, newStudents, teachers, staff, att, pay, billed, out, sal, admissions] = await Promise.all([
      tx.student.count({ where: { status: 'active' } }),
      tx.student.count({ where: { admissionDate: { gte: from, lt: to } } }),
      tx.employee.count({ where: { status: { in: ['active', 'on_leave'] }, staffType: 'teaching' } }),
      tx.employee.count({ where: { status: { in: ['active', 'on_leave'] }, staffType: { not: 'teaching' } } }),
      tx.studentAttendance.groupBy({ by: ['status'], where: { markedAt: { gte: from, lt: to } }, _count: true }),
      tx.payment.aggregate({ where: { status: 'completed', paidAt: { gte: from, lt: to } }, _sum: { amount: true } }),
      tx.invoice.aggregate({ where: { issueDate: { gte: from, lt: to }, status: { notIn: ['cancelled', 'waived'] } }, _sum: { total: true } }),
      tx.$queryRaw<{ owed: Prisma.Decimal | null }[]>`SELECT SUM(total - amount_paid) AS owed FROM invoices WHERE status IN ('pending','partial','overdue')`,
      tx.payrollRun.aggregate({ where: { status: 'paid', paidAt: { gte: from, lt: to } }, _sum: { totalNet: true } }),
      tx.admissionApplication.count({ where: { createdAt: { gte: from, lt: to } } }),
    ]);
    const marked = att.reduce((n, a) => n + a._count, 0);
    const here = att.filter((a) => a.status === 'present' || a.status === 'late').reduce((n, a) => n + a._count, 0);
    const collected = num(pay._sum.amount);
    const salaries = num(sal._sum.totalNet);
    return {
      students, newStudents, teachers, staff,
      attendancePercent: marked ? Math.round((here / marked) * 1000) / 10 : null,
      collected, billed: num(billed._sum.total), outstanding: num(out[0]?.owed), salaries, admissions, surplus: collected - salaries,
    };
  });
}

/** UTC start of the month (or year) containing `ref`, and the start of the next. */
export function periodBounds(period: 'month' | 'year', ref: Date): { from: Date; to: Date; previousFrom: Date; label: string } {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  if (period === 'year') return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)), previousFrom: new Date(Date.UTC(y - 1, 0, 1)), label: String(y) };
  return {
    from: new Date(Date.UTC(y, m, 1)),
    to: new Date(Date.UTC(y, m + 1, 1)),
    previousFrom: new Date(Date.UTC(y, m - 1, 1)),
    label: new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** How a number moved: +12.5, -4, or null when there was nothing to compare with. */
export function changePercent(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}

/**
 * The plain-language verdict on whether the school is growing: students, fees received and
 * attendance weigh in; complaints left open count against it.
 */
export function verdict(cur: Snapshot, prev: Snapshot, complaints: { raised: number; resolved: number; open: number }): { status: 'growing' | 'steady' | 'declining'; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const students = changePercent(cur.students, prev.students);
  if (students !== null && students > 0) { score++; reasons.push(`Students grew by ${students}%`); } else if (students !== null && students < 0) { score--; reasons.push(`Students fell by ${Math.abs(students)}%`); }
  const fees = changePercent(cur.collected, prev.collected);
  if (fees !== null && fees > 5) { score++; reasons.push(`Fees received rose by ${fees}%`); } else if (fees !== null && fees < -5) { score--; reasons.push(`Fees received fell by ${Math.abs(fees)}%`); }
  if (cur.attendancePercent !== null && prev.attendancePercent !== null) {
    const d = Math.round((cur.attendancePercent - prev.attendancePercent) * 10) / 10;
    if (d >= 1) { score++; reasons.push(`Attendance improved by ${d} points`); } else if (d <= -1) { score--; reasons.push(`Attendance dropped by ${Math.abs(d)} points`); }
  }
  if (complaints.open > complaints.resolved && complaints.open >= 3) { score--; reasons.push(`${complaints.open} complaints are still open`); }
  else if (complaints.raised > 0 && complaints.resolved >= complaints.raised) reasons.push('Every complaint raised was resolved');
  if (cur.surplus < 0) reasons.push('Salaries paid were more than the fees received');
  return { status: score > 0 ? 'growing' : score < 0 ? 'declining' : 'steady', reasons };
}
