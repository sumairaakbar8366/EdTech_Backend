import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SubscriptionStateService } from '../billing/subscription-state.service.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import { WebUrls } from '../delivery/web-urls.service.js';
import { BillingService as FeeBillingService } from '../fees/billing.service.js';
import { SchedulerService } from '../jobs/scheduler.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const DAY = 86_400_000;
/** Fee reminders: at most 3 per invoice, at least 6 days apart. */
const MAX_REMINDERS = 3;
const REMINDER_GAP_DAYS = 6;
const pkr = (n: number) => `PKR ${n.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Background jobs that keep schools informed without anyone pressing a button:
 * - fee-overdue reminders to parents (daily),
 * - trial / plan expiry notices to school admins (daily),
 * - a weekly summary report emailed to school admins (Mondays).
 * Every job runs school by school inside its RLS scope, and is safe to run twice.
 */
@Injectable()
export class AutomationService implements OnModuleInit {
  private readonly log = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly notifications: NotificationsService,
    private readonly delivery: DeliveryService,
    private readonly state: SubscriptionStateService,
    private readonly fees: FeeBillingService,
    private readonly redis: RedisService,
    private readonly urls: WebUrls,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({ id: 'fees.overdue-reminders', cron: '0 9 * * *', description: 'Marks unpaid invoices past their due date as overdue and reminds the families (up to 3 times, 6 days apart)', run: () => this.feeReminders() });
    this.scheduler.register({ id: 'billing.expiry-notices', cron: '0 10 * * *', description: 'Tells school admins when the free trial or plan ends in 7/3/1 days, when the grace period starts and when the school is locked', run: () => this.expiryNotices() });
    this.scheduler.register({ id: 'reports.weekly-summary', cron: '0 8 * * 1', description: 'Emails every school admin a summary of last week: attendance, fees, admissions and hiring', run: () => this.weeklyReports() });
  }

  /** Active schools that are not locked (a locked school gets billing notices only). */
  private async openSchools() {
    const schools = await this.prisma.school.findMany({ where: { status: 'active' }, select: { id: true, name: true, slug: true } });
    const out: typeof schools = [];
    for (const s of schools) if (!(await this.state.get(s.id)).locked) out.push(s);
    return out;
  }

  private async adminIds(schoolId: string) {
    const admins = await this.prisma.forSchool(schoolId).user.findMany({
      where: { status: 'active', NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: 'school_admin' } } } },
      select: { id: true, email: true, firstName: true },
    });
    return admins;
  }

  // --- Fee-overdue reminders --------------------------------------------------------------------

  async feeReminders() {
    let reminded = 0;
    for (const s of await this.openSchools()) {
      await this.fees.refreshOverdue(s.id);
      const db = this.prisma.forSchool(s.id);
      const due = await db.invoice.findMany({
        where: {
          status: 'overdue',
          reminderCount: { lt: MAX_REMINDERS },
          OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: new Date(Date.now() - REMINDER_GAP_DAYS * DAY) } }],
        },
        select: { id: true, invoiceNo: true, periodLabel: true, dueDate: true, total: true, amountPaid: true, reminderCount: true, studentId: true, student: { select: { firstName: true, lastName: true } } },
        take: 2000,
      });
      for (const inv of due) {
        const balance = Number(inv.total) - Number(inv.amountPaid);
        if (balance <= 0) continue;
        const n = inv.reminderCount + 1;
        await this.notifications.notifyStudents(s.id, [inv.studentId], { guardians: true, students: false }, {
          eventType: 'fee_overdue',
          title: `${n === 1 ? 'Fee overdue' : `Reminder ${n}: fee overdue`} · ${inv.student.firstName} ${inv.student.lastName}`,
          body: `${pkr(balance)} for ${inv.periodLabel} (${inv.invoiceNo}) was due on ${fmt(inv.dueDate)}. Please pay at the school office or online.`,
          link: '/fees',
        });
        await db.invoice.update({ where: { id: inv.id }, data: { reminderCount: n, lastReminderAt: new Date() } });
        reminded++;
      }
    }
    return { reminded };
  }

  // --- Trial / plan expiry notices ----------------------------------------------------------------

  async expiryNotices() {
    const sent: string[] = [];
    const schools = await this.prisma.school.findMany({ where: { status: 'active' }, select: { id: true, name: true, slug: true } });
    for (const s of schools) {
      const st = await this.state.get(s.id);
      const days = st.daysLeft ?? 99;
      const trial = st.status === 'trialing';
      let kind: string | null = null;
      let title = '';
      let body = '';
      if (st.phase === 'trial' && [7, 3, 1].includes(days)) {
        kind = `trial-${days}`;
        title = `Your free trial ends in ${days} day${days === 1 ? '' : 's'}`;
        body = 'Choose a plan under Plans & billing to keep everything running without interruption. You can pay online by card, bank account, JazzCash or Easypaisa.';
      } else if (st.phase === 'active' && [7, 1].includes(days)) {
        kind = `plan-${days}`;
        title = `Your ${st.tier?.name ?? ''} plan renews in ${days} day${days === 1 ? '' : 's'}`;
        body = 'Renew under Plans & billing to keep access for everyone.';
      } else if (st.phase === 'grace') {
        kind = 'grace';
        title = `Your ${trial ? 'free trial' : 'plan'} has ended`;
        body = `Full access continues for ${days} more day${days === 1 ? '' : 's'}; then the school is locked until payment. Nothing is deleted.`;
      } else if (st.phase === 'expired' && st.endsAt) {
        kind = 'locked';
        title = 'Your school is locked';
        body = 'The subscription has ended. Your data is safe; choose a plan and pay under Plans & billing to unlock it for everyone at once.';
      }
      if (!kind) continue;
      // Once per school, period and notice (the period end changes when the school pays).
      const key = `notice:${s.id}:${st.endsAt ?? 'none'}:${kind}`;
      if (!(await this.redis.set(key, '1', 'EX', 90 * 24 * 3600, 'NX'))) continue;
      const admins = await this.adminIds(s.id);
      await this.notifications.notify(s.id, admins.map((a) => a.id), { eventType: 'billing', title, body, link: '/billing' });
      if (kind === 'locked') {
        const owners = await this.prisma.platformAdmin.findMany({ where: { isActive: true }, select: { email: true, name: true } });
        for (const o of owners) {
          await this.delivery.trySend({ channel: 'email', to: o.email, template: 'notification', data: { name: o.name, schoolName: 'Skool EdTech', title: `${s.name} is now locked`, body: `${s.name} (${s.slug}) did not pay after its ${trial ? 'trial' : 'plan'} and grace period. You can extend it under Schools → Plan & dates.`, url: this.urls.platform('/schools') } });
        }
      }
      sent.push(`${s.slug}:${kind}`);
    }
    return { sent };
  }

  // --- Weekly report ------------------------------------------------------------------------------

  async weeklyReports() {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * DAY);
    let emailed = 0;
    for (const s of await this.openSchools()) {
      const report = await this.weekFor(s.id, from, to);
      const admins = (await this.adminIds(s.id)).filter((a) => a.email);
      for (const a of admins) {
        await this.delivery.trySend({ channel: 'email', to: a.email!, schoolId: s.id, template: 'weekly_report', data: { name: a.firstName, schoolName: s.name, from: from.toISOString(), to: to.toISOString(), ...report, url: this.urls.school(s.slug, '/open?to=%2Freports') } });
        emailed++;
      }
    }
    return { emailed };
  }

  /** Last week's figures for one school (also used by the console's "Run now"). */
  async weekFor(schoolId: string, from: Date, to: Date) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const dateFrom = new Date(from.toISOString().slice(0, 10));
      const [students, newStudents, attendance, payments, open, overdue, admissions, jobApps, flagged] = await Promise.all([
        tx.student.count({ where: { status: 'active' } }),
        tx.student.count({ where: { createdAt: { gte: from, lt: to } } }),
        tx.studentAttendance.groupBy({ by: ['status'], where: { session: { sessionDate: { gte: dateFrom } } }, _count: { _all: true } }),
        tx.payment.aggregate({ where: { status: 'completed', paidAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: true }),
        tx.invoice.aggregate({ where: { status: { in: ['pending', 'partial', 'overdue'] } }, _sum: { total: true, amountPaid: true } }),
        tx.invoice.count({ where: { status: 'overdue' } }),
        tx.admissionApplication.count({ where: { createdAt: { gte: from, lt: to } } }),
        tx.jobApplication.count({ where: { createdAt: { gte: from, lt: to } } }),
        tx.staffAttendance.count({ where: { date: { gte: dateFrom }, geofenceStatus: { not: 'valid' } } }),
      ]);
      const marked = attendance.reduce((t, a) => t + a._count._all, 0);
      const present = attendance.filter((a) => a.status === 'present' || a.status === 'late').reduce((t, a) => t + a._count._all, 0);
      return {
        students,
        newStudents,
        attendancePercent: marked ? Math.round((present / marked) * 1000) / 10 : null,
        collected: Number(payments._sum.amount ?? 0),
        paymentsCount: payments._count,
        outstanding: Number(open._sum.total ?? 0) - Number(open._sum.amountPaid ?? 0),
        overdueInvoices: overdue,
        admissions,
        jobApplications: jobApps,
        flaggedCheckIns: flagged,
      };
    });
  }
}
