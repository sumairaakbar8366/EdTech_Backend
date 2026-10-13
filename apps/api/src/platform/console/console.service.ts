import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GRACE_DAYS, addMonthsUtc } from '@schoolerp/shared';
import { AccountsService } from '../../accounts/accounts.service.js';
import { LoginTicketService } from '../../auth/login-ticket.service.js';
import { SubscriptionStateService } from '../../billing/subscription-state.service.js';
import { WebUrls } from '../../delivery/web-urls.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SUPPORT_PREFIX } from '../../users/users.service.js';

export type PersonKind = 'teacher' | 'staff' | 'student' | 'parent';

const DAY = 86_400_000;

/**
 * The platform owner's view across all schools: schools with their plan, people and activity; a
 * directory of every teacher, staff member, student and parent; the login history; revenue; and
 * "Open as admin" support sessions. Per-school figures are read inside each school's RLS scope.
 */
@Injectable()
export class ConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: SubscriptionStateService,
    private readonly accounts: AccountsService,
    private readonly tickets: LoginTicketService,
    private readonly urls: WebUrls,
  ) {}

  // --- Schools --------------------------------------------------------------------------------

  /** A school's phase from its live (or last) subscription: the same rules as SubscriptionStateService. */
  private phaseOf(sub: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null } | undefined, now = Date.now()) {
    if (!sub) return { phase: 'expired' as const, endsAt: null as Date | null };
    const end = sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd;
    if (sub.status === 'canceled' || sub.status === 'expired') return { phase: 'expired' as const, endsAt: end };
    if (!end) return { phase: sub.status === 'trialing' ? ('trial' as const) : ('active' as const), endsAt: null };
    if (now < end.getTime() && sub.status !== 'past_due') return { phase: sub.status === 'trialing' ? ('trial' as const) : ('active' as const), endsAt: end };
    if (now < end.getTime() + GRACE_DAYS * DAY) return { phase: 'grace' as const, endsAt: end };
    return { phase: 'expired' as const, endsAt: end };
  }

  /**
   * All schools, filtered and paged on the server (fast with thousands): phase counts for the tabs,
   * then per-school figures only for the rows on this page.
   */
  async schools(q: { phase?: 'trial' | 'active' | 'grace' | 'expired'; q?: string; source?: string; page: number; pageSize: number }) {
    const term = q.q?.trim();
    const rows = await this.prisma.school.findMany({
      where: term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { slug: { contains: term.toLowerCase() } }, { application: { contactEmail: { contains: term.toLowerCase() } } }] } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, slug: true, status: true, createdAt: true,
        application: { select: { source: true, contactFirstName: true, contactLastName: true, designation: true, contactEmail: true, contactPhone: true, schoolCity: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, trialEndsAt: true, currentPeriodEnd: true, billingCycle: true, tier: { select: { code: true, name: true } } } },
      },
    });
    const now = Date.now();
    const all = rows.map((s) => {
      const sub = s.subscriptions[0];
      const { phase, endsAt } = this.phaseOf(sub, now);
      return {
        id: s.id, name: s.name, slug: s.slug, status: s.status, createdAt: s.createdAt,
        source: s.application?.source === 'self_signup' ? ('self_signup' as const) : s.application ? ('application' as const) : ('console' as const),
        contact: s.application ? { name: `${s.application.contactFirstName} ${s.application.contactLastName}`, designation: s.application.designation, email: s.application.contactEmail, phone: s.application.contactPhone, city: s.application.schoolCity } : null,
        subscription: { phase, tier: sub?.tier ?? null, billingCycle: sub?.status === 'trialing' ? null : sub?.billingCycle ?? null, endsAt, daysLeft: endsAt ? Math.ceil((endsAt.getTime() - now) / DAY) : null },
      };
    });
    const bySource = all.filter((s) => !q.source || s.source === q.source);
    const counts = { all: bySource.length, trial: 0, active: 0, grace: 0, expired: 0 };
    for (const s of bySource) counts[s.subscription.phase]++;
    const filtered = bySource.filter((s) => !q.phase || s.subscription.phase === q.phase);
    const pageRows = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const paid = await this.prisma.subscriptionPayment.groupBy({ by: ['schoolId'], where: { status: 'confirmed', schoolId: { in: pageRows.map((s) => s.id) } }, _sum: { amount: true }, _max: { paidAt: true, reviewedAt: true } });
    const items = await Promise.all(
      pageRows.map(async (s) => {
        const p = paid.find((x) => x.schoolId === s.id);
        return { ...s, counts: await this.countsFor(s.id), revenue: { total: p?._sum.amount ?? 0, lastPaidAt: p?._max.paidAt ?? p?._max.reviewedAt ?? null } };
      }),
    );
    return { items, total: filtered.length, page: q.page, pageSize: q.pageSize, counts };
  }

  /** Everything about one school for the owner: contact, plan, people, admins, payments and recent sign-ins. */
  async school(id: string) {
    const s = await this.prisma.school.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, status: true, createdAt: true,
        application: { select: { source: true, contactFirstName: true, contactLastName: true, designation: true, contactEmail: true, contactPhone: true, schoolCity: true, schoolWebsite: true } },
        domains: { select: { hostname: true, isPrimary: true, verifiedAt: true } },
      },
    });
    if (!s) throw new NotFoundException('School not found');
    const [state, counts, payments, logins, extra] = await Promise.all([
      this.state.get(id),
      this.countsFor(id),
      this.prisma.subscriptionPayment.findMany({ where: { schoolId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, amount: true, currency: true, method: true, cardBrand: true, cardLast4: true, status: true, billingCycle: true, paidAt: true, createdAt: true, periodEnd: true, failureReason: true, tier: { select: { name: true } } } }),
      this.prisma.loginEvent.findMany({ where: { schoolId: id }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, name: true, identifier: true, roles: true, success: true, reason: true, method: true, createdAt: true } }),
      this.prisma.inSchoolTransaction(id, async (tx) => {
        const notSupport = { NOT: { loginId: { startsWith: SUPPORT_PREFIX } } };
        const [admins, campuses, classes, settings, invoices] = await Promise.all([
          tx.user.findMany({ where: { ...notSupport, userRoles: { some: { role: { key: 'school_admin' } } } }, select: { id: true, firstName: true, lastName: true, email: true, loginId: true, phone: true, status: true, lastLoginAt: true } }),
          tx.campus.count({ where: { isActive: true } }),
          tx.schoolClass.count(),
          tx.schoolSettings.findUnique({ where: { schoolId: id }, select: { timezone: true, currency: true } }),
          tx.invoice.aggregate({ where: { status: { in: ['pending', 'partial', 'overdue'] } }, _sum: { total: true, amountPaid: true }, _count: true }),
        ]);
        return { admins, campuses, classes, settings, feesOutstanding: Number(invoices._sum.total ?? 0) - Number(invoices._sum.amountPaid ?? 0), openInvoices: invoices._count };
      }),
    ]);
    return {
      ...s,
      source: s.application?.source === 'self_signup' ? 'self_signup' : s.application ? 'application' : 'console',
      subscription: state,
      counts: { ...counts, campuses: extra.campuses, classes: extra.classes },
      settings: extra.settings,
      fees: { outstanding: extra.feesOutstanding, openInvoices: extra.openInvoices },
      admins: extra.admins,
      payments,
      logins,
    };
  }

  /** Reach and conversion for the owner dashboard: sign-ups, trials and upgrades per month. */
  async growth() {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
    const [schools, firstPaid, live] = await Promise.all([
      this.prisma.school.findMany({ select: { id: true, createdAt: true, application: { select: { source: true } } } }),
      this.prisma.subscriptionPayment.groupBy({ by: ['schoolId'], where: { status: 'confirmed' }, _min: { paidAt: true, reviewedAt: true } }),
      this.prisma.subscription.findMany({ where: { status: { in: ['trialing', 'active', 'past_due'] } }, select: { status: true, trialEndsAt: true, currentPeriodEnd: true } }),
    ]);
    const signups = new Map(months.map((m) => [m, 0]));
    const selfSignups = new Map(months.map((m) => [m, 0]));
    const upgrades = new Map(months.map((m) => [m, 0]));
    for (const s of schools) {
      const m = s.createdAt.toISOString().slice(0, 7);
      if (signups.has(m)) {
        signups.set(m, signups.get(m)! + 1);
        if (s.application?.source === 'self_signup') selfSignups.set(m, selfSignups.get(m)! + 1);
      }
    }
    for (const p of firstPaid) {
      const at = p._min.paidAt ?? p._min.reviewedAt;
      const m = at?.toISOString().slice(0, 7);
      if (m && upgrades.has(m)) upgrades.set(m, upgrades.get(m)! + 1);
    }
    const nowMs = Date.now();
    const phases = live.map((s) => this.phaseOf(s, nowMs).phase);
    const everPaid = firstPaid.length;
    return {
      totals: {
        schools: schools.length,
        selfSignups: schools.filter((s) => s.application?.source === 'self_signup').length,
        onTrial: phases.filter((p) => p === 'trial').length,
        paying: phases.filter((p) => p === 'active').length,
        everPaid,
        conversion: schools.length ? Math.round((everPaid / schools.length) * 1000) / 10 : 0,
      },
      byMonth: months.map((m) => ({ month: m, signups: signups.get(m)!, selfSignups: selfSignups.get(m)!, upgrades: upgrades.get(m)! })),
    };
  }

  private countsFor(schoolId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const notSupport = { NOT: { loginId: { startsWith: SUPPORT_PREFIX } } };
      const [teachers, staff, students, parents, logins, activeLast7, lastLogin] = await Promise.all([
        tx.teacher.count({ where: { status: { in: ['active', 'on_leave'] } } }),
        tx.nonTeachingStaff.count({ where: { status: { in: ['active', 'on_leave'] } } }),
        tx.student.count({ where: { status: 'active' } }),
        tx.guardian.count(),
        tx.user.count({ where: notSupport }),
        tx.user.count({ where: { ...notSupport, lastLoginAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
        tx.user.aggregate({ where: notSupport, _max: { lastLoginAt: true } }),
      ]);
      return { teachers, staff, students, parents, logins, activeLast7, lastLoginAt: lastLogin._max.lastLoginAt };
    });
  }

  // --- People directory -----------------------------------------------------------------------

  /** Everyone of one kind, across all schools (or one school), from that kind's own table. */
  async people(kind: PersonKind, opts: { schoolId?: string; q?: string; page: number; pageSize: number }) {
    const schools = await this.prisma.school.findMany({ where: opts.schoolId ? { id: opts.schoolId } : undefined, select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } });
    const q = opts.q?.trim();
    const name = (fields: string[]) => (q ? { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' as const } })) } : {});
    const rows: Record<string, unknown>[] = [];
    for (const s of schools) {
      const people = await this.prisma.inSchoolTransaction(s.id, async (tx) => {
        const users = async (ids: (string | null)[]) => {
          const list = await tx.user.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, loginId: true, email: true, lastLoginAt: true, status: true } });
          return new Map(list.map((u) => [u.id, u]));
        };
        if (kind === 'teacher' || kind === 'staff') {
          const where = name(['firstName', 'lastName', 'email', 'employeeNo', 'loginId', 'designation']) as Prisma.TeacherWhereInput;
          const list = kind === 'teacher' ? await tx.teacher.findMany({ where, orderBy: { firstName: 'asc' } }) : await tx.nonTeachingStaff.findMany({ where: where as Prisma.NonTeachingStaffWhereInput, orderBy: { firstName: 'asc' } });
          const u = await users(list.map((p) => p.userId));
          return list.map((p) => ({ id: p.employeeId, name: `${p.firstName} ${p.lastName}`, number: p.employeeNo, detail: [p.designation, p.department].filter(Boolean).join(' · '), email: p.email, phone: p.phone, status: p.status, since: p.joinDate, loginId: p.loginId, login: p.userId ? u.get(p.userId) ?? null : null }));
        }
        if (kind === 'student') {
          const list = await tx.student.findMany({
            where: name(['firstName', 'lastName', 'admissionNo']) as Prisma.StudentWhereInput,
            orderBy: { firstName: 'asc' },
            select: { id: true, firstName: true, lastName: true, admissionNo: true, status: true, admissionDate: true, userId: true, enrollments: { where: { status: 'enrolled' }, orderBy: { createdAt: 'desc' }, select: { section: { select: { name: true, schoolClass: { select: { name: true } } } } }, take: 1 } },
          });
          const u = await users(list.map((p) => p.userId));
          return list.map((p) => {
            const login = p.userId ? u.get(p.userId) ?? null : null;
            const sec = p.enrollments[0]?.section;
            return { id: p.id, name: `${p.firstName} ${p.lastName}`, number: p.admissionNo, detail: sec ? `${sec.schoolClass.name} ${sec.name}` : 'Not enrolled', email: login?.email ?? null, phone: null, status: p.status, since: p.admissionDate, loginId: login?.loginId ?? null, login };
          });
        }
        const list = await tx.guardian.findMany({
          where: name(['firstName', 'lastName', 'email', 'phone']) as Prisma.GuardianWhereInput,
          orderBy: { firstName: 'asc' },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true, userId: true, children: { select: { student: { select: { firstName: true } } } } },
        });
        const u = await users(list.map((p) => p.userId));
        return list.map((p) => {
          const login = p.userId ? u.get(p.userId) ?? null : null;
          return { id: p.id, name: `${p.firstName} ${p.lastName}`, number: null, detail: p.children.length ? `Parent of ${p.children.map((c) => c.student.firstName).join(', ')}` : 'No children linked', email: p.email, phone: p.phone, status: 'active', since: p.createdAt, loginId: login?.loginId ?? null, login };
        });
      });
      rows.push(...people.map((p) => ({ ...p, school: s })));
    }
    const start = (opts.page - 1) * opts.pageSize;
    return { items: rows.slice(start, start + opts.pageSize), total: rows.length, page: opts.page, pageSize: opts.pageSize };
  }

  // --- Finance --------------------------------------------------------------------------------

  async finance() {
    const now = new Date();
    const yearAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const [payments, live, tiers] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({ where: { status: 'confirmed', OR: [{ paidAt: { gte: yearAgo } }, { reviewedAt: { gte: yearAgo } }] }, select: { amount: true, method: true, paidAt: true, reviewedAt: true } }),
      this.prisma.subscription.findMany({ where: { status: { in: ['trialing', 'active', 'past_due'] } }, select: { status: true, billingCycle: true, currentPeriodEnd: true, trialEndsAt: true, school: { select: { id: true, name: true, slug: true } }, tier: { select: { name: true, priceMonthly: true, priceAnnual: true } } } }),
      this.prisma.subscriptionTier.count({ where: { isActive: true } }),
    ]);
    const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(yearAgo.getUTCFullYear(), yearAgo.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
    const byMonth = new Map(months.map((m) => [m, 0]));
    const byMethod = new Map<string, number>();
    let total = 0;
    for (const p of payments) {
      const at = (p.paidAt ?? p.reviewedAt)!;
      const m = at.toISOString().slice(0, 7);
      const amount = Number(p.amount);
      if (byMonth.has(m)) byMonth.set(m, byMonth.get(m)! + amount);
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + amount);
      total += amount;
    }
    // Monthly recurring revenue: every paid plan at its monthly equivalent.
    const mrr = live
      .filter((s) => s.status === 'active')
      .reduce((sum, s) => sum + (s.billingCycle === 'annual' ? Number(s.tier.priceAnnual ?? 0) / 12 : Number(s.tier.priceMonthly ?? 0)), 0);
    const soon = new Date(Date.now() + 14 * DAY);
    const renewals = live
      .map((s) => ({ school: s.school, plan: s.tier.name, status: s.status, endsAt: s.status === 'trialing' ? s.trialEndsAt : s.currentPeriodEnd }))
      .filter((r) => r.endsAt && r.endsAt <= soon)
      .sort((a, b) => a.endsAt!.getTime() - b.endsAt!.getTime());
    const thisMonth = byMonth.get(now.toISOString().slice(0, 7)) ?? 0;
    return {
      currency: 'PKR',
      mrr: Math.round(mrr),
      revenue12m: total,
      thisMonth,
      paying: live.filter((s) => s.status === 'active').length,
      trialing: live.filter((s) => s.status === 'trialing').length,
      plans: tiers,
      byMonth: months.map((m) => ({ month: m, amount: byMonth.get(m)! })),
      byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
      endingSoon: renewals,
    };
  }

  // --- Owner actions ---------------------------------------------------------------------------

  /** "Open as admin": a one-time link into the school as its hidden Platform Support login. */
  async supportSession(adminId: string, schoolId: string) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { slug: true, status: true } });
    if (!school) throw new NotFoundException('School not found');
    const userId = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const existing = await tx.user.findFirst({ where: { loginId: { startsWith: SUPPORT_PREFIX } }, select: { id: true, status: true } });
      if (existing) {
        if (existing.status !== 'active') await tx.user.update({ where: { id: existing.id }, data: { status: 'active' } });
        return existing.id;
      }
      // A login with no password and no email: it can only be entered through a support ticket.
      const id = await this.accounts.nextLoginId(tx, schoolId, 'SUP', new Date().getUTCFullYear());
      const user = await tx.user.create({ data: { schoolId, loginId: id.loginId, email: null, passwordHash: null, firstName: 'Platform', lastName: 'Support', mustChangePassword: false }, select: { id: true } });
      await tx.loginId.create({ data: { schoolId, ...id, userId: user.id } });
      const admin = await tx.role.findFirstOrThrow({ where: { key: 'school_admin', isSystem: true }, select: { id: true } });
      await tx.userRole.create({ data: { userId: user.id, roleId: admin.id, schoolId } });
      return user.id;
    });
    const ticket = await this.tickets.create({ schoolId, userId, purpose: 'support', platformAdminId: adminId });
    return { url: this.urls.school(school.slug, `/welcome?ticket=${ticket}`), expiresInSeconds: 120 };
  }

  /**
   * The owner sets a school's plan by hand: extend or restart a free trial, or grant a paid plan
   * until a date (e.g. after an offline payment). The previous live subscription is closed.
   */
  async setSubscription(schoolId: string, dto: { tierCode: string; status: 'trialing' | 'active'; endsOn: string; billingCycle?: 'monthly' | 'annual' }) {
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { code: dto.tierCode } });
    if (!tier) throw new BadRequestException('Unknown plan');
    const end = new Date(`${dto.endsOn}T23:59:59.000Z`);
    if (Number.isNaN(end.getTime()) || end.getTime() < Date.now()) throw new BadRequestException('Choose an end date in the future');
    if (end > addMonthsUtc(new Date(), 60)) throw new BadRequestException('The end date can be at most 5 years ahead');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const live = await tx.subscription.findFirst({ where: { schoolId, status: { in: ['trialing', 'active', 'past_due'] } } });
      if (live) await tx.subscription.update({ where: { id: live.id }, data: { status: 'canceled', canceledAt: now } });
      await tx.subscription.create({
        data: dto.status === 'trialing'
          ? { schoolId, tierId: tier.id, status: 'trialing', trialStartsAt: live?.trialStartsAt && live.trialStartsAt < end ? live.trialStartsAt : now, trialEndsAt: end }
          : { schoolId, tierId: tier.id, status: 'active', billingCycle: dto.billingCycle ?? 'monthly', billingStartsAt: now, currentPeriodStart: now, currentPeriodEnd: end },
      });
    });
    this.state.invalidate(schoolId);
    return this.state.get(schoolId);
  }
}
