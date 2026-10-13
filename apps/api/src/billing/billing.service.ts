import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { FEATURE_INFO, PLAN_FEATURES_LIST, addMonthsUtc } from '@schoolerp/shared';
import { NotificationsService } from '../communication/notifications.service.js';
import { tierFeatures } from './tier-features.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionStateService } from './subscription-state.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class SubmitPaymentDto {
  @Transform(trim) @IsString() @MaxLength(40) tierCode: string;
  @IsIn(['monthly', 'annual']) billingCycle: 'monthly' | 'annual';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100_000_000) amount: number;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) payerName: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) payerBank: string;
  @Transform(trim) @IsString() @MinLength(4) @MaxLength(40) payerAccount: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(100) reference: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) paidOn: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) note?: string | null;
}

export class ReviewPaymentDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) note?: string | null;
}

export class BillingSettingsDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(80) bankName?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) accountTitle?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(40) accountNumber?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(34) iban?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(1000) instructions?: string | null;
  /** Let schools pay by manual bank transfer as well as online. */
  @IsOptional() @IsBoolean() bankTransferEnabled?: boolean;
  /** Yearly price of the own-domain add-on (PKR); null stops offering it. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) domainPriceYearly?: number | null;
}

const SCHOOL = { select: { id: true, name: true, slug: true } } as const;

/**
 * Activates a paid plan for one month or one year: renewing the same plan while it is still running
 * extends it; anything else (trial, other plan, lapsed) starts today. Returns the new period.
 */
export async function activatePlan(tx: Prisma.TransactionClient, p: { schoolId: string; tierId: string; billingCycle: 'monthly' | 'annual' }, now = new Date()) {
  const live = await tx.subscription.findFirst({ where: { schoolId: p.schoolId, status: { in: ['trialing', 'active', 'past_due'] } } });
  const start = live && live.status === 'active' && live.tierId === p.tierId && live.currentPeriodEnd && live.currentPeriodEnd > now ? live.currentPeriodEnd : now;
  const end = addMonthsUtc(start, p.billingCycle === 'annual' ? 12 : 1);
  if (live) await tx.subscription.update({ where: { id: live.id }, data: { status: 'canceled', canceledAt: now } });
  await tx.subscription.create({ data: { schoolId: p.schoolId, tierId: p.tierId, status: 'active', billingCycle: p.billingCycle, billingStartsAt: now, currentPeriodStart: start, currentPeriodEnd: end } });
  return { start, end };
}
const TIER = { select: { code: true, name: true } } as const;

/**
 * Plans & billing. A school chooses a plan, pays by bank transfer into the platform account and
 * submits the payment details; the platform owner confirms (activating the plan at once) or rejects.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: SubscriptionStateService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The plan catalogue for the public marketing page: active plans, prices and features. */
  async publicPlans() {
    const tiers = await this.prisma.subscriptionTier.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { entitlements: true } });
    return tiers.map((t) => ({
      code: t.code, name: t.name, priceMonthly: t.priceMonthly, priceAnnual: t.priceAnnual, currency: t.currency,
      maxCampuses: t.maxCampuses, maxStudents: t.maxStudents, maxStaff: t.maxStaff, features: tierFeatures(t),
    }));
  }

  async overview(schoolId: string) {
    const [state, tiers, bank, payments, settings] = await Promise.all([
      this.state.get(schoolId),
      this.prisma.subscriptionTier.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { entitlements: true } }),
      this.prisma.platformBillingSettings.findUnique({ where: { id: 1 } }),
      this.prisma.subscriptionPayment.findMany({ where: { schoolId }, orderBy: { createdAt: 'desc' }, take: 50, include: { tier: TIER } }),
      this.prisma.forSchool(schoolId).schoolSettings.findUnique({ where: { schoolId }, select: { customDomainUntil: true } }),
    ]);
    return {
      state,
      plans: tiers.map((t) => ({
        code: t.code, name: t.name, priceMonthly: t.priceMonthly, priceAnnual: t.priceAnnual, currency: t.currency,
        maxCampuses: t.maxCampuses, maxStudents: t.maxStudents, maxStaff: t.maxStaff, features: tierFeatures(t),
      })),
      features: PLAN_FEATURES_LIST.map((key) => ({ key, ...FEATURE_INFO[key] })),
      // Online (card, bank account, JazzCash, Easypaisa) always; manual bank transfer only if the owner allows it.
      onlinePayments: { provider: 'sandbox', methods: ['card', 'bank_account', 'jazzcash', 'easypaisa'] },
      // Add-ons bought separately from the plan.
      addons: {
        domain: {
          priceYearly: bank?.domainPriceYearly ?? null,
          paidUntil: settings?.customDomainUntil ?? null,
          active: !!settings?.customDomainUntil && settings.customDomainUntil > new Date(),
          includedInPlan: state.features.includes('custom_domain') && !(settings?.customDomainUntil && settings.customDomainUntil > new Date()),
        },
      },
      bank: bank?.bankTransferEnabled ? { bankName: bank.bankName, accountTitle: bank.accountTitle, accountNumber: bank.accountNumber, iban: bank.iban, instructions: bank.instructions } : null,
      payments: payments.map(({ checkoutToken: _t, ...p }) => p),
    };
  }

  async submit(schoolId: string, userId: string, dto: SubmitPaymentDto) {
    const settings = await this.prisma.platformBillingSettings.findUnique({ where: { id: 1 }, select: { bankTransferEnabled: true } });
    if (!settings?.bankTransferEnabled) throw new BadRequestException('Bank transfer is not available. Please pay online by card, bank account, JazzCash or Easypaisa.');
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { code: dto.tierCode } });
    if (!tier || !tier.isActive) throw new BadRequestException('Choose an available plan');
    if (await this.prisma.subscriptionPayment.findFirst({ where: { schoolId, status: 'pending' }, select: { id: true } })) {
      throw new BadRequestException('A payment is already waiting for confirmation; we will confirm it shortly');
    }
    const user = await this.prisma.forSchool(schoolId).user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    return this.prisma.subscriptionPayment.create({
      data: {
        schoolId, tierId: tier.id, billingCycle: dto.billingCycle, amount: dto.amount, currency: tier.currency,
        payerName: dto.payerName, payerBank: dto.payerBank, payerAccount: dto.payerAccount, reference: dto.reference,
        paidOn: new Date(`${dto.paidOn}T00:00:00Z`), note: dto.note ?? null, submittedBy: userId, submittedByName: user ? `${user.firstName} ${user.lastName}` : null,
      },
      include: { tier: TIER },
    });
  }

  // --- Platform ---------------------------------------------------------------------------

  listPayments(status?: string) {
    return this.prisma.subscriptionPayment.findMany({
      where: status && ['initiated', 'pending', 'confirmed', 'rejected', 'failed'].includes(status) ? { status: status as 'pending' } : undefined,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 500,
      include: { school: SCHOOL, tier: TIER },
    });
  }

  async summary() {
    const [pending, confirmedThisMonth] = await Promise.all([
      this.prisma.subscriptionPayment.count({ where: { status: 'pending' } }),
      this.prisma.subscriptionPayment.aggregate({ where: { status: 'confirmed', reviewedAt: { gte: new Date(new Date().toISOString().slice(0, 8) + '01T00:00:00Z') } }, _sum: { amount: true }, _count: true }),
    ]);
    return { pending, confirmedThisMonth: { count: confirmedThisMonth._count, amount: confirmedThisMonth._sum.amount ?? 0 } };
  }

  /** Confirms the transfer and activates the plan for one month or one year (from today, or extends a running paid period). */
  async confirm(adminId: string, id: string, dto: ReviewPaymentDto) {
    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.subscriptionPayment.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('Payment not found');
      if (p.status !== 'pending') throw new BadRequestException('This payment has already been reviewed');
      if (!p.tierId) throw new BadRequestException('This payment is not for a plan');
      const now = new Date();
      const { start, end } = await activatePlan(tx, { schoolId: p.schoolId, tierId: p.tierId, billingCycle: p.billingCycle }, now);
      return tx.subscriptionPayment.update({ where: { id }, data: { status: 'confirmed', reviewedBy: adminId, reviewedAt: now, reviewNote: dto.note ?? null, periodStart: start, periodEnd: end }, include: { school: SCHOOL, tier: TIER } });
    });
    this.state.invalidate(payment.schoolId);
    await this.notifySchool(payment.schoolId, `Payment confirmed · ${payment.tier?.name ?? ''} plan active`, `Thank you! Your plan is active until ${payment.periodEnd!.toISOString().slice(0, 10)}.`);
    return payment;
  }

  async reject(adminId: string, id: string, dto: ReviewPaymentDto) {
    if (!dto.note) throw new BadRequestException('Give the reason (the school sees it)');
    const p = await this.prisma.subscriptionPayment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Payment not found');
    if (p.status !== 'pending') throw new BadRequestException('This payment has already been reviewed');
    const updated = await this.prisma.subscriptionPayment.update({ where: { id }, data: { status: 'rejected', reviewedBy: adminId, reviewedAt: new Date(), reviewNote: dto.note }, include: { school: SCHOOL, tier: TIER } });
    await this.notifySchool(p.schoolId, 'Payment could not be confirmed', dto.note);
    return updated;
  }

  bankSettings() {
    return this.prisma.platformBillingSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }

  saveBankSettings(dto: BillingSettingsDto) {
    return this.prisma.platformBillingSettings.upsert({ where: { id: 1 }, create: { id: 1, ...dto }, update: dto });
  }

  private async notifySchool(schoolId: string, title: string, body: string | null) {
    const admins = await this.prisma.forSchool(schoolId).user.findMany({ where: { status: 'active', userRoles: { some: { role: { key: 'school_admin' } } } }, select: { id: true } });
    await this.notifications.notify(schoolId, admins.map((a) => a.id), { eventType: 'billing', title, body, link: '/billing' });
  }
}
