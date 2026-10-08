import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AppRequest } from '../common/request-context.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { EntitlementGuard } from './entitlement.guard.js';
import { SubscriptionStateService, type SubscriptionState } from './subscription-state.service.js';

const DAY = 86_400_000;
const SCHOOL = '0192f0a0-0000-7000-8000-00000000000a';

function serviceWith(sub: Record<string, unknown> | null) {
  const prisma = { subscription: { findFirst: async () => sub } } as unknown as PrismaService;
  return new SubscriptionStateService(prisma);
}
const trial = (endsInDays: number) => ({ status: 'trialing', trialEndsAt: new Date(Date.now() + endsInDays * DAY), currentPeriodEnd: null, billingCycle: 'monthly', tier: { code: 'growth', name: 'Growth', entitlements: [] } });
const paid = (code: string, endsInDays: number) => ({ status: 'active', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + endsInDays * DAY), billingCycle: 'monthly', tier: { code, name: code, entitlements: [] as { featureKey: string; isEnabled: boolean }[] } });

describe('SubscriptionStateService', () => {
  it('trial: every feature, not read-only', async () => {
    const s = await serviceWith(trial(10)).get(SCHOOL);
    expect(s.phase).toBe('trial');
    expect(s.readOnly).toBe(false);
    expect(s.features).toContain('theme');
    expect(s.daysLeft).toBe(10);
  });

  it('trial ended 3 days ago: grace with full access, 4 days left', async () => {
    const s = await serviceWith(trial(-3)).get(SCHOOL);
    expect(s.phase).toBe('grace');
    expect(s.readOnly).toBe(false);
    expect(s.daysLeft).toBe(4);
  });

  it('trial ended 8 days ago: read-only, data still visible (features kept)', async () => {
    const s = await serviceWith(trial(-8)).get(SCHOOL);
    expect(s.phase).toBe('expired');
    expect(s.readOnly).toBe(true);
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

  it('no subscription at all: read-only', async () => {
    const s = await serviceWith(null).get(SCHOOL);
    expect(s.readOnly).toBe(true);
  });
});

function guardFor(state: Partial<SubscriptionState>) {
  const full: SubscriptionState = { phase: 'active', readOnly: false, tier: null, status: 'active', billingCycle: 'monthly', endsAt: null, graceEndsAt: null, daysLeft: 10, features: ['core', 'website'], ...state };
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

  it('read-only mode: reads allowed, writes refused, daily basics allowed', async () => {
    const g = guardFor({ phase: 'expired', readOnly: true, features: ['core', 'website', 'exams'] });
    expect(await status(g.canActivate(ctx('GET', '/students')))).toBe(200);
    expect(await status(g.canActivate(ctx('POST', '/students')))).toBe(402);
    expect(await status(g.canActivate(ctx('POST', '/attendance/sessions/abc')))).toBe(200);
    expect(await status(g.canActivate(ctx('POST', '/billing/payments')))).toBe(200);
    expect(await status(g.canActivate(ctx('POST', '/auth/change-password')))).toBe(200);
  });

  it('theme colour needs the theme feature', async () => {
    expect(await status(guardFor({}).canActivate(ctx('PATCH', '/settings/school', { primaryColor: '#000000' })))).toBe(402);
    expect(await status(guardFor({}).canActivate(ctx('PATCH', '/settings/school', { currency: 'PKR' })))).toBe(200);
    // Going back to the standard theme never needs the feature.
    expect(await status(guardFor({}).canActivate(ctx('PATCH', '/settings/school', { primaryColor: null, secondaryColor: null })))).toBe(200);
  });
});
