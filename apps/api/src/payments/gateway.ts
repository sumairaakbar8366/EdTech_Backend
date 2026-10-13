import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** What a school can pay with online. All amounts are in PKR. */
export const ONLINE_METHODS = ['card', 'bank_account', 'jazzcash', 'easypaisa'] as const;
export type OnlineMethod = (typeof ONLINE_METHODS)[number];

export interface CheckoutRequest {
  /** Our opaque session id; the gateway echoes it back in its webhook. */
  token: string;
  amount: string;
  currency: 'PKR';
  description: string;
  customer: { name: string; email: string | null; phone: string | null };
  returnUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

/** A payment outcome reported by the gateway (already verified). */
export interface GatewayEvent {
  token: string;
  providerTxnId: string;
  status: 'paid' | 'failed';
  method: OnlineMethod;
  cardBrand?: string | null;
  cardLast4?: string | null;
  payerName?: string | null;
  failureReason?: string | null;
}

/**
 * A payment gateway (PayFast, Safepay, JazzCash, Stripe …). Card / account details are entered only
 * on the gateway's own page; this system only sees the verified outcome (PCI DSS SAQ-A scope).
 */
export interface PaymentGateway {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<{ redirectUrl: string }>;
  /** Verifies the webhook's signature and returns the outcome; throws if it is not genuine. */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): GatewayEvent;
}

/** HMAC-SHA256 of the raw body (hex), compared in constant time. */
export function hmac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyHmac(secret: string, body: string, signature: string | undefined): void {
  const expected = Buffer.from(hmac(secret, body), 'hex');
  const given = Buffer.from(typeof signature === 'string' ? signature : '', 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new BadRequestException('Invalid webhook signature');
}
