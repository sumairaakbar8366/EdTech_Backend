import { Injectable } from '@nestjs/common';
import { GRACE_DAYS, PLAN_FEATURES_LIST, type PlanFeature, type SubscriptionPhase } from '@schoolerp/shared';
import { tierFeatures } from './tier-features.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 86_400_000;
const TTL_MS = 30_000;
const TIER = { tier: { select: { code: true, name: true, entitlements: { select: { featureKey: true, isEnabled: true } } } } } as const;

export interface SubscriptionState {
  phase: SubscriptionPhase;
  /** No changes allowed (except daily basics and paying) until the school pays. */
  readOnly: boolean;
  tier: { code: string; name: string } | null;
  status: string | null;
  billingCycle: string | null;
  /** End of the trial or paid period. */
  endsAt: string | null;
  /** End of the grace period (full access until then). */
  graceEndsAt: string | null;
  /** Days until the current phase ends (trial/active: until endsAt; grace: until graceEndsAt). */
  daysLeft: number | null;
  features: PlanFeature[];
}

/**
 * The school's subscription as the product sees it: trial → (paid) active → grace (GRACE_DAYS of
 * full access after the end date) → expired (read-only). Cached briefly per school.
 */
@Injectable()
export class SubscriptionStateService {
  private readonly cache = new Map<string, { at: number; state: SubscriptionState }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(schoolId?: string) {
    if (schoolId) this.cache.delete(schoolId);
    else this.cache.clear();
  }

  async get(schoolId: string): Promise<SubscriptionState> {
    const hit = this.cache.get(schoolId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.state;
    const state = await this.compute(schoolId);
    this.cache.set(schoolId, { at: Date.now(), state });
    return state;
  }

  private async compute(schoolId: string): Promise<SubscriptionState> {
    const sub =
      (await this.prisma.subscription.findFirst({ where: { schoolId, status: { in: ['trialing', 'active', 'past_due'] } }, orderBy: { createdAt: 'desc' }, include: TIER })) ??
      (await this.prisma.subscription.findFirst({ where: { schoolId }, orderBy: { createdAt: 'desc' }, include: TIER }));
    const now = Date.now();
    if (!sub) return { phase: 'expired', readOnly: true, tier: null, status: null, billingCycle: null, endsAt: null, graceEndsAt: null, daysLeft: null, features: [...PLAN_FEATURES_LIST] };

    const trialing = sub.status === 'trialing';
    const end = trialing ? sub.trialEndsAt : sub.currentPeriodEnd;
    // The trial includes every feature; a paid plan includes the set the platform owner gave it.
    const features = trialing ? [...PLAN_FEATURES_LIST] : tierFeatures(sub.tier);
    const base = { tier: { code: sub.tier.code, name: sub.tier.name }, status: sub.status, billingCycle: sub.status === 'trialing' ? null : sub.billingCycle, features };
    if (sub.status === 'canceled' || sub.status === 'expired') {
      return { ...base, phase: 'expired', readOnly: true, endsAt: end?.toISOString() ?? null, graceEndsAt: null, daysLeft: 0 };
    }
    if (!end) return { ...base, phase: trialing ? 'trial' : 'active', readOnly: false, endsAt: null, graceEndsAt: null, daysLeft: null };
    const graceEnd = end.getTime() + GRACE_DAYS * DAY;
    if (now < end.getTime() && sub.status !== 'past_due') {
      return { ...base, phase: trialing ? 'trial' : 'active', readOnly: false, endsAt: end.toISOString(), graceEndsAt: new Date(graceEnd).toISOString(), daysLeft: Math.ceil((end.getTime() - now) / DAY) };
    }
    if (now < graceEnd) {
      return { ...base, phase: 'grace', readOnly: false, endsAt: end.toISOString(), graceEndsAt: new Date(graceEnd).toISOString(), daysLeft: Math.ceil((graceEnd - now) / DAY) };
    }
    return { ...base, phase: 'expired', readOnly: true, endsAt: end.toISOString(), graceEndsAt: new Date(graceEnd).toISOString(), daysLeft: 0 };
  }
}
