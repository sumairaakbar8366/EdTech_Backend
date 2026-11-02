import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { STORAGE_MB_BY_PLAN, USAGE_GRACE_DAYS, USAGE_WARN_RATIO } from '@schoolerp/shared';
import { DeliveryService } from '../delivery/delivery.service.js';
import { OwnerAlertsService } from '../delivery/owner-alerts.service.js';
import { WebUrls } from '../delivery/web-urls.service.js';
import { SchedulerService } from '../jobs/scheduler.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionStateService } from './subscription-state.service.js';

const DAY = 86_400_000;
export type UsageMetric = 'students' | 'staff' | 'storage';
const LABEL: Record<UsageMetric, { name: string; unit: string }> = {
  students: { name: 'students', unit: '' },
  staff: { name: 'staff', unit: '' },
  storage: { name: 'stored files', unit: ' MB' },
};

export interface UsageLine { metric: UsageMetric; label: string; used: number; limit: number | null; level: 'ok' | 'near' | 'over' }

/**
 * How big each school has grown against its plan: active students, staff and stored files. From 80%
 * the school admins and the owner are told; past 100% the school has a fortnight to change plan, and
 * after that the school is paused (it can sign in and pay) until the plan fits again. Nothing is deleted.
 */
@Injectable()
export class UsageService implements OnModuleInit {
  private readonly log = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly delivery: DeliveryService,
    private readonly owner: OwnerAlertsService,
    private readonly urls: WebUrls,
    private readonly state: SubscriptionStateService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({ id: 'billing.usage-check', cron: '0 3 * * *', description: 'Compares every school’s students, staff and stored files with its plan; warns the school and the owner from 80%, and pauses a school that stays over its plan after the grace period', run: () => this.checkAll() });
  }

  async measure(schoolId: string): Promise<UsageLine[]> {
    const sub = await this.prisma.subscription.findFirst({ where: { schoolId, status: { in: ['trialing', 'active', 'past_due'] } }, orderBy: { createdAt: 'desc' }, select: { status: true, tier: { select: { code: true, maxStudents: true, maxStaff: true, entitlements: { where: { featureKey: 'storage_mb' }, select: { limitValue: true } } } } } });
    const db = this.prisma.forSchool(schoolId);
    const [students, staff, bytes] = await Promise.all([
      db.student.count({ where: { status: 'active' } }),
      db.employee.count({ where: { status: { in: ['active', 'on_leave'] } } }),
      db.document.aggregate({ _sum: { sizeBytes: true } }),
    ]);
    // A free trial is sized by the registration; limits apply to the plan the school chose.
    const paid = sub && sub.status !== 'trialing';
    const storageLimit = paid ? sub.tier.entitlements[0]?.limitValue ?? STORAGE_MB_BY_PLAN[sub.tier.code] ?? null : null;
    const raw: [UsageMetric, number, number | null][] = [
      ['students', students, paid ? sub.tier.maxStudents : null],
      ['staff', staff, paid ? sub.tier.maxStaff : null],
      ['storage', Math.ceil((bytes._sum.sizeBytes ?? 0) / 1_048_576), storageLimit],
    ];
    return raw.map(([metric, used, limit]) => ({
      metric, label: LABEL[metric].name, used, limit,
      level: limit === null ? 'ok' : (metric === 'storage' ? used >= limit : used > limit) ? 'over' : used >= limit * USAGE_WARN_RATIO ? 'near' : 'ok',
    }));
  }

  /** Re-checks one school, records and announces what changed. */
  async check(schoolId: string): Promise<UsageLine[]> {
    const lines = await this.measure(schoolId);
    const now = new Date();
    let changed = false;
    for (const l of lines) {
      const existing = await this.prisma.schoolUsageAlert.findUnique({ where: { schoolId_metric: { schoolId, metric: l.metric } } });
      if (l.level === 'ok' || l.limit === null) {
        if (existing) { await this.prisma.schoolUsageAlert.delete({ where: { id: existing.id } }); changed = true; }
        continue;
      }
      const over = l.level === 'over';
      const data = {
        level: l.level, used: l.used, limit: l.limit,
        firstOverAt: over ? existing?.firstOverAt ?? now : null,
        graceEndsAt: over ? existing?.graceEndsAt ?? new Date(now.getTime() + USAGE_GRACE_DAYS * DAY) : null,
      };
      if (!existing || existing.level !== l.level) changed = true;
      const row = existing
        ? await this.prisma.schoolUsageAlert.update({ where: { id: existing.id }, data })
        : await this.prisma.schoolUsageAlert.create({ data: { schoolId, metric: l.metric, ...data } });
      if (row.notifiedLevel !== l.level) {
        await this.announce(schoolId, l, row.graceEndsAt);
        await this.prisma.schoolUsageAlert.update({ where: { id: row.id }, data: { notifiedLevel: l.level } });
      }
    }
    if (changed) this.state.invalidate(schoolId);
    return lines;
  }

  async checkAll() {
    const schools = await this.prisma.school.findMany({ where: { status: 'active' }, select: { id: true } });
    let warned = 0;
    for (const s of schools) {
      try {
        if ((await this.check(s.id)).some((l) => l.level !== 'ok')) warned++;
      } catch (e) {
        this.log.error(`usage check failed for ${s.id}: ${(e as Error).message}`);
      }
    }
    return { schools: schools.length, warned };
  }

  private async announce(schoolId: string, l: UsageLine, graceEndsAt: Date | null) {
    try {
      const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, slug: true } });
      const unit = LABEL[l.metric].unit;
      const over = l.level === 'over';
      const lines = over
        ? [`Your school now has ${l.used}${unit} ${LABEL[l.metric].name}, and your plan includes ${l.limit}${unit}.`, `Please change to a bigger plan by ${graceEndsAt?.toISOString().slice(0, 10)}. After that date the school is paused (people can still sign in, and you can pay) until the plan fits. Nothing is deleted.`]
        : [`Your school has used ${l.used}${unit} of the ${l.limit}${unit} ${LABEL[l.metric].name} your plan includes.`, 'When you pass the limit you will have two weeks to move to a bigger plan, so it is a good time to look at the plans.'];
      const admins = await this.prisma.forSchool(schoolId).user.findMany({ where: { status: 'active', email: { not: null }, NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: 'school_admin' } } } }, select: { email: true, firstName: true } });
      for (const a of admins) await this.delivery.trySend({ channel: 'email', to: a.email!, schoolId, template: 'plan_usage', data: { name: a.firstName, schoolName: school.name, lines, url: this.urls.school(school.slug, '/billing'), over } });
      await this.owner.raise({
        kind: 'school_usage', title: `${school.name} ${over ? 'is over' : 'is near'} its plan: ${LABEL[l.metric].name}`, body: lines[0], link: `/schools/${schoolId}`, schoolId,
        ...(over && { email: { template: 'owner_alert' as const, data: { title: `${school.name} has outgrown its plan`, lines, url: this.urls.platform(`/schools/${schoolId}`) } } }),
      });
    } catch (e) {
      this.log.error(`usage notice failed: ${(e as Error).message}`);
    }
  }
}
