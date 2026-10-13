import webpush from 'web-push';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { PermanentDeliveryError, type ChannelProvider, type OutgoingMessage } from '../delivery.types.js';

/**
 * Browser / phone notifications through the Web Push protocol (VAPID keys). `to` is a
 * push_subscriptions id; a subscription the push service reports as gone (404 / 410) is deleted.
 */
export class WebPushProvider implements ChannelProvider {
  readonly name = 'webpush';

  constructor(
    private readonly prisma: PrismaService,
    vapid: { publicKey: string; privateKey: string; subject: string },
  ) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(m: OutgoingMessage): Promise<{ providerMessageId?: string }> {
    if (!m.schoolId) throw new PermanentDeliveryError('Push messages belong to a school');
    const db = this.prisma.forSchool(m.schoolId);
    const sub = await db.pushSubscription.findUnique({ where: { id: m.to } });
    if (!sub) throw new PermanentDeliveryError('This device has unsubscribed');
    try {
      const res = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: m.subject, body: m.text.slice(0, 240), url: m.url ?? '/' }),
        { TTL: 24 * 3600, urgency: 'normal' },
      );
      await db.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: new Date() } });
      return { providerMessageId: String(res.statusCode) };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        throw new PermanentDeliveryError('The device unsubscribed (removed)');
      }
      if (status && status >= 400 && status < 500 && status !== 429) throw new PermanentDeliveryError(`Push service refused (${status})`);
      throw e;
    }
  }
}
