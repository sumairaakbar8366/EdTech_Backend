import { Injectable } from '@nestjs/common';
import { SubscriptionStateService } from '../billing/subscription-state.service.js';
import { ComplaintsService } from '../complaints/complaints.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { changePercent, periodBounds, schoolSnapshot, verdict } from './school-snapshot.js';

const n = (v: unknown) => (v == null ? 0 : Number(v));

/**
 * The principal's and admin's growth report: how the school did this month or year against the
 * last, whether it is growing, how many complaints came in and how much was resolved. Part of the
 * paid plans: during the free trial only a preview of what it contains is returned.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: SubscriptionStateService,
    private readonly complaints: ComplaintsService,
  ) {}

  async performance(schoolId: string, period: 'month' | 'year', ref: Date) {
    const state = await this.plan.get(schoolId);
    const bounds = periodBounds(period, ref);
    if (state.phase === 'trial') {
      // Free trial: show that the report exists and what it covers, not the report itself.
      return {
        locked: true as const, reason: 'trial' as const, period: { kind: period, label: bounds.label }, daysLeft: state.daysLeft,
        covers: ['Students and staff growth', 'Fees received, outstanding and salaries paid', 'Estimated surplus', 'Attendance trend', 'Complaints raised and resolved', 'A plain verdict: is the school growing?', 'Monthly and yearly comparison'],
      };
    }
    const [cur, prev, cs] = await Promise.all([
      schoolSnapshot(this.prisma, schoolId, bounds.from, bounds.to),
      schoolSnapshot(this.prisma, schoolId, bounds.previousFrom, bounds.from),
      this.complaints.stats(schoolId, bounds.from, bounds.to),
    ]);
    const months = period === 'year' ? 12 : 6;
    const lastMonth = period === 'year' ? new Date(Date.UTC(bounds.from.getUTCFullYear(), 11, 1)) : bounds.from;
    const first = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() - (months - 1), 1));
    const end = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 1));
    const trend = await this.trend(schoolId, first, end, months);
    return {
      locked: false as const, period: { kind: period, label: bounds.label, from: bounds.from, to: bounds.to },
      current: cur, previous: prev,
      changes: { students: changePercent(cur.students, prev.students), collected: changePercent(cur.collected, prev.collected), salaries: changePercent(cur.salaries, prev.salaries), admissions: changePercent(cur.admissions, prev.admissions) },
      complaints: cs, verdict: verdict(cur, prev, cs), trend,
    };
  }

  private async trend(schoolId: string, from: Date, to: Date, months: number) {
    const rows = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const [fees, joined, raised] = await Promise.all([
        tx.$queryRaw<{ m: string; v: unknown }[]>`SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS m, SUM(amount) AS v FROM payments WHERE status = 'completed' AND paid_at >= ${from} AND paid_at < ${to} GROUP BY 1`,
        tx.$queryRaw<{ m: string; v: bigint }[]>`SELECT to_char(date_trunc('month', admission_date), 'YYYY-MM') AS m, COUNT(*) AS v FROM students WHERE admission_date >= ${from} AND admission_date < ${to} GROUP BY 1`,
        tx.$queryRaw<{ m: string; v: bigint }[]>`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS m, COUNT(*) AS v FROM complaints WHERE created_at >= ${from} AND created_at < ${to} GROUP BY 1`,
      ]);
      return { fees, joined, raised };
    });
    return Array.from({ length: months }, (_, i) => {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      return { month: key, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), collected: n(rows.fees.find((r) => r.m === key)?.v), newStudents: n(rows.joined.find((r) => r.m === key)?.v), complaints: n(rows.raised.find((r) => r.m === key)?.v) };
    });
  }
}
