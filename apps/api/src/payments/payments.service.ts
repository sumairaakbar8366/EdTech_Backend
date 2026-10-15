import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { activatePlan } from '../billing/billing.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { setSchool } from '../prisma/prisma.service.js';
import { SubscriptionStateService } from '../billing/subscription-state.service.js';
import { NotificationsService } from '../communication/notifications.service.js';
import type { Env } from '../config/env.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import { OwnerAlertsService } from '../delivery/owner-alerts.service.js';
import { WebUrls } from '../delivery/web-urls.service.js';
import { SchedulerService } from '../jobs/scheduler.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hmac, type GatewayEvent, type OnlineMethod, type PaymentGateway } from './gateway.js';
import { SANDBOX_SIGNATURE_HEADER, SandboxGateway } from './sandbox.gateway.js';

const CHECKOUT_MINUTES = 30;
const METHOD_LABEL: Record<string, string> = { card: 'Card', bank_account: 'Bank account', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank_transfer: 'Bank transfer' };

export interface SandboxPayment {
  method: OnlineMethod;
  outcome: 'success' | 'decline';
  cardBrand?: string;
  last4?: string;
  payerName?: string;
}

/**
 * Online subscription payments in PKR. The school opens a checkout for a plan (the price comes from
 * the plan, never from the browser), pays on the gateway's page, and the gateway's signed webhook
 * activates the plan at once. Webhooks are idempotent: a repeated or late one never activates twice.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly log = new Logger(PaymentsService.name);
  readonly gateway: PaymentGateway;
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: SubscriptionStateService,
    private readonly notifications: NotificationsService,
    private readonly delivery: DeliveryService,
    private readonly urls: WebUrls,
    private readonly scheduler: SchedulerService,
    private readonly alerts: OwnerAlertsService,
    config: ConfigService<Env, true>,
  ) {
    // Development falls back to a key derived from the JWT secret; production must set its own.
    this.webhookSecret = config.get('PAYMENT_WEBHOOK_SECRET', { infer: true }) ?? hmac(config.get('JWT_ACCESS_SECRET', { infer: true }), 'payment-webhook');
    this.gateway = new SandboxGateway(urls, this.webhookSecret);
  }

  onModuleInit(): void {
    this.scheduler.register({ id: 'payments.expire-checkouts', cron: '*/10 * * * *', description: 'Marks online checkouts that were never paid as failed after 30 minutes', run: () => this.expireCheckouts() });
  }

  /** Opens a checkout for a plan; returns where to send the browser. */
  async checkout(schoolId: string, userId: string, tierCode: string, billingCycle: 'monthly' | 'annual') {
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { code: tierCode } });
    if (!tier || !tier.isActive) throw new BadRequestException('Choose an available plan');
    const price = billingCycle === 'annual' ? tier.priceAnnual : tier.priceMonthly;
    if (price === null) throw new BadRequestException('This plan is priced on request. Please contact us.');
    if (tier.currency !== 'PKR') throw new BadRequestException('Online payments are in PKR; this plan is priced in another currency.');
    return this.openCheckout(schoolId, userId, { purpose: 'plan', tierId: tier.id, billingCycle, amount: price, label: `${tier.name} plan (${billingCycle === 'annual' ? '1 year' : '1 month'})` });
  }

  private async openCheckout(schoolId: string, userId: string, item: { purpose: 'plan' | 'domain'; tierId: string | null; billingCycle: 'monthly' | 'annual'; amount: { toFixed(n: number): string }; label: string }) {
    const [school, user] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, slug: true } }),
      this.prisma.forSchool(schoolId).user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, lastName: true, email: true, phone: true } }),
    ]);
    // Only one open checkout per school: an older unpaid one is closed.
    await this.prisma.subscriptionPayment.updateMany({ where: { schoolId, status: 'initiated' }, data: { status: 'failed', failureReason: 'Replaced by a newer checkout' } });

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + CHECKOUT_MINUTES * 60_000);
    const name = `${user.firstName} ${user.lastName}`;
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        schoolId, tierId: item.tierId, purpose: item.purpose, billingCycle: item.billingCycle, amount: item.amount.toFixed(2), currency: 'PKR', method: 'card', provider: this.gateway.name,
        checkoutToken: token, checkoutExpiresAt: expiresAt, status: 'initiated', payerName: name, submittedBy: userId, submittedByName: name,
      },
    });
    const back = this.urls.school(school.slug, `/admin/billing?payment=${payment.id}`);
    const { redirectUrl } = await this.gateway.createCheckout({
      token, amount: item.amount.toFixed(2), currency: 'PKR', description: `${school.name} · ${item.label}`,
      customer: { name, email: user.email, phone: user.phone }, returnUrl: back, cancelUrl: `${back}&cancelled=1`, expiresAt,
    });
    return { paymentId: payment.id, redirectUrl, expiresAt };
  }

  /** Opens a checkout for the own-domain add-on (one year at the owner's price). */
  async checkoutDomain(schoolId: string, userId: string) {
    const settings = await this.prisma.platformBillingSettings.findUnique({ where: { id: 1 }, select: { domainPriceYearly: true } });
    if (!settings?.domainPriceYearly || Number(settings.domainPriceYearly) <= 0) throw new BadRequestException('Own domains are not offered at the moment. Please contact us.');
    return this.openCheckout(schoolId, userId, { purpose: 'domain', tierId: null, billingCycle: 'annual', amount: settings.domainPriceYearly, label: 'Own domain (1 year)' });
  }

  /** The checkout as the gateway page shows it (public: the token is the secret). */
  async session(token: string) {
    const p = await this.prisma.subscriptionPayment.findUnique({ where: { checkoutToken: token }, include: { school: { select: { name: true, slug: true } }, tier: { select: { name: true } } } });
    if (!p) throw new NotFoundException('Checkout not found');
    return {
      provider: p.provider,
      school: p.school.name,
      plan: p.tier?.name ?? 'Own domain (1 year)',
      billingCycle: p.billingCycle,
      amount: p.amount.toFixed(2),
      currency: p.currency,
      status: p.status,
      expiresAt: p.checkoutExpiresAt,
      expired: p.status === 'initiated' && !!p.checkoutExpiresAt && p.checkoutExpiresAt < new Date(),
      returnUrl: this.urls.school(p.school.slug, `/admin/billing?payment=${p.id}`),
    };
  }

  /** Sandbox only: the test checkout page "pays" and the gateway sends its signed webhook. */
  async sandboxPay(token: string, body: SandboxPayment) {
    if (this.gateway.name !== 'sandbox') throw new ForbiddenException('The test gateway is not active');
    const s = await this.session(token);
    if (s.status !== 'initiated') throw new BadRequestException('This checkout is already closed');
    if (s.expired) throw new BadRequestException('This checkout has expired. Start again from Plans & billing.');
    const event: GatewayEvent = {
      token,
      providerTxnId: `SBX-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      status: body.outcome === 'success' ? 'paid' : 'failed',
      method: body.method,
      cardBrand: body.method === 'card' ? body.cardBrand ?? null : null,
      cardLast4: body.last4 ?? null,
      payerName: body.payerName ?? null,
      failureReason: body.outcome === 'success' ? null : body.method === 'card' ? 'The card was declined by the issuing bank' : 'The payment was not authorised',
    };
    const raw = JSON.stringify(event);
    await this.handleWebhook('sandbox', raw, { [SANDBOX_SIGNATURE_HEADER]: hmac(this.webhookSecret, raw) });
    return { status: event.status, returnUrl: s.returnUrl };
  }

  /** The gateway's server-to-server notice. Verified, idempotent, activates the plan when paid. */
  async handleWebhook(provider: string, rawBody: string, headers: Record<string, string | string[] | undefined>) {
    if (provider !== this.gateway.name) throw new BadRequestException('Unknown payment provider');
    const e = this.gateway.parseWebhook(rawBody, headers);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the payment row so two deliveries of the same webhook cannot both activate.
      await tx.$executeRaw`SELECT 1 FROM subscription_payments WHERE checkout_token = ${e.token} FOR UPDATE`;
      const p = await tx.subscriptionPayment.findUnique({ where: { checkoutToken: e.token }, include: { tier: { select: { name: true } } } });
      if (!p) throw new NotFoundException('Checkout not found');
      if (p.status === 'confirmed') return { payment: p, changed: false };
      const card = { method: e.method, providerTxnId: e.providerTxnId, cardBrand: e.cardBrand ?? null, cardLast4: e.cardLast4 ?? null, ...(e.payerName && { payerName: e.payerName }) };
      if (e.status === 'failed') {
        if (p.status !== 'initiated') return { payment: p, changed: false };
        return { payment: await tx.subscriptionPayment.update({ where: { id: p.id }, data: { ...card, status: 'failed', failureReason: e.failureReason ?? 'Payment declined' }, include: { tier: { select: { name: true } } } }), changed: true };
      }
      // Paid (even after the checkout expired: the money was taken, so the plan / add-on is activated).
      const { start, end } = p.purpose === 'domain' || !p.tierId ? await extendDomain(tx, p.schoolId, now) : await activatePlan(tx, { schoolId: p.schoolId, tierId: p.tierId, billingCycle: p.billingCycle }, now);
      const payment = await tx.subscriptionPayment.update({
        where: { id: p.id },
        data: { ...card, status: 'confirmed', paidAt: now, paidOn: now, reference: e.providerTxnId, reviewedAt: now, reviewNote: 'Paid online', periodStart: start, periodEnd: end, failureReason: null },
        include: { tier: { select: { name: true } } },
      });
      return { payment, changed: true };
    });
    if (result.changed) {
      this.state.invalidate(result.payment.schoolId);
      await this.afterOutcome(result.payment);
    }
    return { ok: true };
  }

  async status(schoolId: string, id: string) {
    const p = await this.prisma.subscriptionPayment.findFirst({ where: { id, schoolId }, include: { tier: { select: { code: true, name: true } } } });
    if (!p) throw new NotFoundException('Payment not found');
    const { checkoutToken: _t, ...rest } = p;
    return rest;
  }

  private async expireCheckouts() {
    const { count } = await this.prisma.subscriptionPayment.updateMany({ where: { status: 'initiated', checkoutExpiresAt: { lt: new Date() } }, data: { status: 'failed', failureReason: 'Checkout expired without payment' } });
    return { expired: count };
  }

  /** Receipt / failure notice to the school's admins, and a heads-up to the platform owner. */
  private async afterOutcome(p: { id: string; schoolId: string; status: string; amount: { toFixed(n: number): string }; billingCycle: string; method: string; providerTxnId: string | null; cardBrand: string | null; cardLast4: string | null; failureReason: string | null; periodEnd: Date | null; tier: { name: string } | null }) {
    try {
      const school = await this.prisma.school.findUniqueOrThrow({ where: { id: p.schoolId }, select: { name: true, slug: true } });
      const admins = await this.prisma.forSchool(p.schoolId).user.findMany({ where: { status: 'active', userRoles: { some: { role: { key: 'school_admin' } } } }, select: { id: true, email: true, firstName: true } });
      const paid = p.status === 'confirmed';
      const method = `${METHOD_LABEL[p.method] ?? p.method}${p.cardBrand ? ` (${p.cardBrand}${p.cardLast4 ? ` ···· ${p.cardLast4}` : ''})` : p.cardLast4 ? ` ···· ${p.cardLast4}` : ''}`;
      await this.notifications.notify(p.schoolId, admins.map((a) => a.id), {
        eventType: 'billing',
        title: paid ? `Payment received · ${(p.tier?.name ?? 'Own domain')} plan active` : 'Online payment failed',
        body: paid ? `PKR ${Number(p.amount.toFixed(2)).toLocaleString('en-PK')} by ${method}. Active until ${p.periodEnd!.toISOString().slice(0, 10)}.` : p.failureReason,
        link: '/billing',
      });
      for (const a of admins.filter((x) => x.email)) {
        await this.delivery.trySend({
          channel: 'email', to: a.email!, schoolId: p.schoolId,
          template: paid ? 'payment_receipt' : 'payment_failed',
          data: { name: a.firstName, schoolName: school.name, plan: (p.tier?.name ?? 'Own domain'), cycle: p.billingCycle, amount: p.amount.toFixed(2), method, txnId: p.providerTxnId ?? '', periodEnd: p.periodEnd?.toISOString() ?? '', reason: p.failureReason ?? '', billingUrl: this.urls.school(school.slug, '/admin/billing') },
        });
      }
      if (paid) {
        const plan = p.tier?.name ?? 'Own domain';
        await this.alerts.raise({
          kind: 'payment_received',
          title: `Payment received: ${school.name}`,
          body: `PKR ${p.amount.toFixed(2)} for ${plan} (${p.billingCycle}) by ${method}.`,
          link: '/payments',
          schoolId: p.schoolId,
          email: { template: 'owner_payment_received', data: { schoolName: school.name, plan, cycle: p.billingCycle, amount: p.amount.toFixed(2), method, txnId: p.providerTxnId ?? '', consoleUrl: this.urls.platform('/payments') } },
        });
      }
    } catch (e) {
      this.log.error(`payment notices failed: ${(e as Error).message}`);
    }
  }
}

/** Own-domain add-on: one more year from today, or from the current end if it is still running. */
async function extendDomain(tx: Prisma.TransactionClient, schoolId: string, now: Date) {
  await setSchool(tx, schoolId);
  const settings = await tx.schoolSettings.findUnique({ where: { schoolId }, select: { customDomainUntil: true } });
  const start = settings?.customDomainUntil && settings.customDomainUntil > now ? settings.customDomainUntil : now;
  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes()));
  await tx.schoolSettings.update({ where: { schoolId }, data: { customDomainUntil: end } });
  return { start, end };
}
