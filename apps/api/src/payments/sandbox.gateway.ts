import { BadRequestException } from '@nestjs/common';
import type { WebUrls } from '../delivery/web-urls.service.js';
import { ONLINE_METHODS, verifyHmac, type CheckoutRequest, type GatewayEvent, type PaymentGateway } from './gateway.js';

export const SANDBOX_SIGNATURE_HEADER = 'x-gateway-signature';

/**
 * Test gateway for development and demos, until a merchant account is connected. Its checkout page
 * is served by our web app on the public site (/pay/<token>) and offers every method a Pakistani
 * gateway does: Visa / Mastercard / UnionPay credit and debit cards, bank account, JazzCash and
 * Easypaisa. Nothing is charged. Its "webhook" is signed with the same HMAC scheme a real one uses.
 */
export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox';

  constructor(
    private readonly urls: WebUrls,
    private readonly secret: string,
  ) {}

  async createCheckout(req: CheckoutRequest) {
    return { redirectUrl: this.urls.site(`/pay/${req.token}`) };
  }

  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): GatewayEvent {
    const sig = headers[SANDBOX_SIGNATURE_HEADER];
    verifyHmac(this.secret, rawBody, Array.isArray(sig) ? sig[0] : sig);
    const e = JSON.parse(rawBody) as GatewayEvent;
    if (!e.token || !e.providerTxnId || !['paid', 'failed'].includes(e.status) || !ONLINE_METHODS.includes(e.method)) throw new BadRequestException('Malformed webhook');
    return e;
  }
}
