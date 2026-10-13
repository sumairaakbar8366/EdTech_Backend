import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AppRequest } from '../common/request-context.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementGuard } from './entitlement.guard.js';
import { SubscriptionStateService, type SubscriptionState } from './subscription-state.service.js';

const DAY = 86_400_000;
const SCHOOL = '0192f0a0-0000-7000-8000-00000000000a';

function serviceWith(sub: Record<string, unknown> | null, domainUntil: Date | null = null) {
  const prisma = {
    subscription: { findFirst: async () => sub },
    forSchool: () => ({ schoolSettings: { findUnique: async () => ({ customDomainUntil: domainUntil }) } }),
  } as unknown as PrismaService;
  return new SubscriptionStateService(prisma);
}
const trial = (endsInDays: number) => ({ status: 'trialing', trialEndsAt: new Date(Date.now() + endsInDays * DAY), currentPeriodEnd: null, billingCycle: 'monthly', tier: { code: 'growth', name: 'Growth', entitlements: [] } });
const paid = (code: string, endsInDays: number) => ({ status: 'active', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + endsInDays * DAY), billingCycle: 'monthly', tier: { code, name: code, entitlements: [] as { featureKey: string; isEnabled: boolean }[] } });

describe('SubscriptionStateService', () => {
  it('trial: every feature except the own domain, not locked', async () => {
    const s = await serviceWith(trial(10)).get(SCHOOL);
    expect(s.phase).toBe('trial');
    expect(s.locked).toBe(false);
    expect(s.features).toContain('theme');
    expect(s.features).not.toContain('custom_domain');
    expect(s.daysLeft).toBe(10);
  });

  it('trial ended 1 day ago: grace with full access, 2 days left', async () => {
    const s = await serviceWith(trial(-1)).get(SCHOOL);
    expect(s.phase).toBe('grace');
    expect(s.locked).toBe(false);
    expect(s.daysLeft).toBe(2);
  });

  it('trial ended 4 days ago: locked (features kept for when they pay)', async () => {
    const s = await serviceWith(trial(-4)).get(SCHOOL);
    expect(s.phase).toBe('expired');
    expect(s.locked).toBe(true);
    expect(s.features).toContain('exams');
  });

  it('paid Starter: only its features', async () => {
    const s = await serviceWith(paid('starter', 20)).get(SCHOOL);
    expect(s.phase).toBe('active');
    expect(s.features).toEqual(['core', 'website']);
  });

  it('a plan the owner edited uses its own features', async () => {
    const sub = { ...paid('starter', 20), tier: { code: 'starter', name: 'Starter', entitlements: [{ featureKey: 'core', isEnabled: true }, { featureKey: 'exams', isEnabled: true }, { featureKey: 'website', isEnabled: false }] } };
    const s = await serviceWith(sub).get(SCHOOL);
    expect(s.features).toEqual(['core', 'exams']);
    expect(s.tier).toEqual({ code: 'starter', name: 'Starter' });
  });

  it('own-domain add-on adds the feature to any paid plan while it is paid', async () => {
    expect((await serviceWith(paid('starter', 20), new Date(Date.now() + 100 * DAY)).get(SCHOOL)).features).toContain('custom_domain');
    expect((await serviceWith(paid('starter', 20), new Date(Date.now() - DAY)).get(SCHOOL)).features).not.toContain('custom_domain');
  });

  it('no subscription at all: locked', async () => {
    const s = await serviceWith(null).get(SCHOOL);
    expect(s.locked).toBe(true);
  });
});

function guardFor(state: Partial<SubscriptionState>) {
  const full: SubscriptionState = { phase: 'active', locked: false, tier: null, status: 'active', billingCycle: 'monthly', endsAt: null, graceEndsAt: null, daysLeft: 10, features: ['core', 'website'], ...state };
  return new EntitlementGuard({ get: async () => full } as unknown as SubscriptionStateService);
}
function ctx(method: string, url: string, body: unknown = {}) {
  const req = { method, originalUrl: `/api${url}`, url: `/api${url}`, body, auth: { scope: 'school', schoolId: SCHOOL, userId: 'u' } } as unknown as AppRequest;
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}
async function status(p: Promise<boolean>) {
  try {
    return (await p) ? 200 : 403;
  } catch (e) {
    return (e as HttpException).getStatus();
  }
}

describe('EntitlementGuard', () => {
  it('blocks a feature outside the plan with 402, even for reading', async () => {
    expect(await status(guardFor({}).canActivate(ctx('GET', '/exams')))).toBe(402);
    expect(await status(guardFor({}).canActivate(ctx('GET', '/students')))).toBe(200);
  });

  it('locked: everything refused except signing in, plan state and paying', async () => {
    const g = guardFor({ phase: 'expired', locked: true, features: ['core', 'website', 'exams'] });
    expect(await status(g.canActivate(ctx('GET', '/students')))).toBe(402);
    expect(await status(g.canActivate(ctx('POST', '/students')))).toBe(402);
    expect(await status(g.canActivate(ctx('POST', '/attendance/sessions/abc')))).toBe(402);
    expect(await status(g.canActivate(ctx('GET', '/notifications/unread-count')))).toBe(402);
    expect(await status(g.canActivate(ctx('GET', '/subscription')))).toBe(200);
    expect(await status(g.canActivate(ctx('GET', '/billing')))).toBe(200);
    expect(await status(g.canActivate(ctx('POST', '/billing/checkout')))).toBe(200);
    expect(await status(g.canActivate(ctx('POST', '/auth/change-password')))).toBe(200);
  });

  it('theme colour needs the theme feature', async () => {
    expect(await status(guardFor({}).canActivate(ctx('PATCH', '/settings/school', { primaryColor: '#000000' })))).toBe(402);
    expect(await status(guardFor({}).canActivate(ctx('PATCH', '/settings/school', { currency: 'PKR' })))).toBe(200);
    // Going back to the standard theme never needs the feature.
    expect(await status(guardFor({}).canActivate(ctx('PATCH', '/settings/school', { primaryColor: null, secondaryColor: null })))).toBe(200);
  });
});
