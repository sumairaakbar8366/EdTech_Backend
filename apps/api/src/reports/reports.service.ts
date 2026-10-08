import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/**
 * Page 14 reporting views, computed live from the operational tables (no report worker yet).
 * Each query runs inside the school's RLS transaction.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Financial report: collections by month (last 12), dues by class, and invoice status totals. */
  finance(schoolId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const [byMonth, byClass, byStatus, methods] = await Promise.all([
        tx.$queryRaw<{ month: string; collected: Prisma.Decimal; payments: bigint }[]>`
          SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount) AS collected, COUNT(*) AS payments
          FROM payments WHERE status = 'completed' AND paid_at >= date_trunc('month', now()) - interval '11 months'
          GROUP BY 1 ORDER BY 1`,
        tx.$queryRaw<{ class_name: string; level: number; billed: Prisma.Decimal; paid: Prisma.Decimal; overdue: bigint }[]>`
          SELECT c.name AS class_name, c.level, SUM(i.total) AS billed, SUM(i.amount_paid) AS paid,
                 COUNT(*) FILTER (WHERE i.status = 'overdue') AS overdue
          FROM invoices i
          JOIN academic_years y ON y.id = i.academic_year_id AND y.is_current
          JOIN student_enrollments e ON e.student_id = i.student_id AND e.academic_year_id = i.academic_year_id
          JOIN sections s ON s.id = e.section_id
          JOIN classes c ON c.id = s.class_id
          WHERE i.status NOT IN ('cancelled', 'waived')
          GROUP BY c.name, c.level ORDER BY c.level`,
        tx.invoice.groupBy({ by: ['status'], _count: { _all: true }, _sum: { total: true, amountPaid: true } }),
        tx.payment.groupBy({ by: ['method'], where: { status: 'completed' }, _sum: { amount: true }, _count: { _all: true } }),
      ]);
      return {
        byMonth: byMonth.map((r) => ({ month: r.month, collected: num(r.collected), payments: num(r.payments) })),
        byClass: byClass.map((r) => ({ className: r.class_name, billed: num(r.billed), paid: num(r.paid), outstanding: num(r.billed) - num(r.paid), overdueInvoices: num(r.overdue) })),
        byStatus: byStatus.map((r) => ({ status: r.status, invoices: r._count._all, total: num(r._sum.total), paid: num(r._sum.amountPaid) })),
        byMethod: methods.map((m) => ({ method: m.method, payments: m._count._all, amount: num(m._sum.amount) })),
      };
    });
  }

  /** Attendance report for the last `days` days: student attendance by class, class-session outcomes, staff check-ins. */
  attendance(schoolId: string, days = 30) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const since = new Date(Date.now() - days * 86_400_000);
      const [byClass, sessions, staff] = await Promise.all([
        tx.$queryRaw<{ class_name: string; level: number; present: bigint; late: bigint; absent: bigint; excused: bigint }[]>`
          SELECT c.name AS class_name, c.level,
                 COUNT(*) FILTER (WHERE a.status = 'present') AS present, COUNT(*) FILTER (WHERE a.status = 'late') AS late,
                 COUNT(*) FILTER (WHERE a.status = 'absent') AS absent, COUNT(*) FILTER (WHERE a.status = 'excused') AS excused
          FROM student_attendance a
          JOIN class_sessions cs ON cs.id = a.session_id
          JOIN sections s ON s.id = cs.section_id
          JOIN classes c ON c.id = s.class_id
          WHERE cs.session_date >= ${since}::date
          GROUP BY c.name, c.level ORDER BY c.level`,
        tx.classSession.groupBy({ by: ['status'], where: { sessionDate: { gte: since } }, _count: { _all: true } }),
        tx.staffAttendance.groupBy({ by: ['geofenceStatus', 'reviewStatus'], where: { date: { gte: since } }, _count: { _all: true } }),
      ]);
      return {
        days,
        byClass: byClass.map((r) => {
          const counted = num(r.present) + num(r.late) + num(r.absent);
          return { className: r.class_name, present: num(r.present), late: num(r.late), absent: num(r.absent), excused: num(r.excused), rate: counted ? Math.round(((num(r.present) + num(r.late)) / counted) * 1000) / 10 : null };
        }),
        sessions: Object.fromEntries(sessions.map((s) => [s.status, s._count._all])),
        staff: {
          valid: staff.filter((s) => s.geofenceStatus === 'valid').reduce((t, s) => t + s._count._all, 0),
          flagged: staff.filter((s) => s.geofenceStatus === 'flagged').reduce((t, s) => t + s._count._all, 0),
          unknown: staff.filter((s) => s.geofenceStatus === 'unknown').reduce((t, s) => t + s._count._all, 0),
          pendingReview: staff.filter((s) => s.reviewStatus === 'pending').reduce((t, s) => t + s._count._all, 0),
        },
      };
    });
  }

  /** Academic report: every published exam with its pass rate and average, by class. */
  academics(schoolId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const rows = await tx.$queryRaw<{ exam_id: string; exam_name: string; start_date: Date; class_name: string; level: number; students: bigint; passed: bigint; average: Prisma.Decimal }[]>`
        SELECT x.id AS exam_id, x.name AS exam_name, x.start_date, c.name AS class_name, c.level,
               COUNT(*) AS students, COUNT(*) FILTER (WHERE r.passed) AS passed, AVG(r.percentage) AS average
        FROM report_cards r
        JOIN exams x ON x.id = r.exam_id AND x.status = 'published'
        JOIN sections s ON s.id = r.section_id
        JOIN classes c ON c.id = s.class_id
        GROUP BY x.id, x.name, x.start_date, c.name, c.level
        ORDER BY x.start_date DESC, c.level`;
      const exams = new Map<string, { examId: string; name: string; startDate: string; classes: { className: string; students: number; passRate: number; average: number }[] }>();
      for (const r of rows) {
        const e = exams.get(r.exam_id) ?? { examId: r.exam_id, name: r.exam_name, startDate: r.start_date.toISOString().slice(0, 10), classes: [] };
        e.classes.push({ className: r.class_name, students: num(r.students), passRate: num(r.students) ? Math.round((num(r.passed) / num(r.students)) * 1000) / 10 : 0, average: Math.round(num(r.average) * 10) / 10 });
        exams.set(r.exam_id, e);
      }
      return [...exams.values()];
    });
  }
}
