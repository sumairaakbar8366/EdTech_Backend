import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeliveryService } from '../delivery/delivery.service.js';
import { WebUrls } from '../delivery/web-urls.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Outside channels in use. Email is always on; SMS / WhatsApp and push are paused (user decision
 * 2026-10-13: email only for now). The providers stay in the code; switch these on to bring them back.
 */
const MOBILE_CHANNELS_ON = false;
const PUSH_ON = false;

export interface NotificationInput {
  /** fee_paid, result_published, assignment_posted, payroll_paid, student_absent, announcement, message … */
  eventType: string;
  title: string;
  body?: string | null;
  /** In-app path inside the recipient's role area, e.g. "/fees". */
  link?: string | null;
}

/**
 * Page 11 notification service. Every notification is stored in-app and also sent by email (always),
 * by SMS or WhatsApp when the school chose one in Settings, and as a push notification to the
 * person's devices. Other modules call `notify…` after their own transaction commits; a failure here
 * is logged and never undoes the business action.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly urls: WebUrls,
  ) {}

  async notify(schoolId: string, recipientIds: (string | null | undefined)[], n: NotificationInput): Promise<void> {
    const ids = [...new Set(recipientIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return;
    try {
      await this.prisma.forSchool(schoolId).notification.createMany({
        data: ids.map((recipientId) => ({ schoolId, recipientId, eventType: n.eventType, title: n.title, body: n.body ?? null, link: n.link ?? null })),
      });
    } catch (e) {
      this.log.error(`notify ${n.eventType} failed: ${(e as Error).message}`);
      return;
    }
    // Outside channels run in the background: the caller's request does not wait for them.
    void this.fanOut(schoolId, ids, n).catch((e: Error) => this.log.error(`fan-out ${n.eventType} failed: ${e.message}`));
  }

  /** Email (always), SMS / WhatsApp (the school's choice) and push for each recipient. */
  private async fanOut(schoolId: string, ids: string[], n: NotificationInput): Promise<void> {
    const [school, settings] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, slug: true } }),
      this.prisma.forSchool(schoolId).schoolSettings.findUnique({ where: { schoolId }, select: { mobileChannel: true } }),
    ]);
    const db = this.prisma.forSchool(schoolId);
    const users = await db.user.findMany({
      where: { id: { in: ids }, status: 'active', NOT: { loginId: { startsWith: 'SUP-' } } },
      select: { id: true, firstName: true, email: true, phone: true, employee: { select: { phone: true } }, guardian: { select: { phone: true } }, pushSubscriptions: { select: { id: true } } },
    });
    const url = this.urls.school(school.slug, `/open?to=${encodeURIComponent(n.link ?? '/')}`);
    const mobile = MOBILE_CHANNELS_ON && (settings?.mobileChannel === 'sms' || settings?.mobileChannel === 'whatsapp') ? settings.mobileChannel : null;
    for (const u of users) {
      const data = { name: u.firstName, schoolName: school.name, title: n.title, body: n.body ?? null, url };
      if (u.email) await this.delivery.trySend({ channel: 'email', to: u.email, template: 'notification', schoolId, data });
      const phone = u.phone ?? u.employee?.phone ?? u.guardian?.phone;
      if (mobile && phone) await this.delivery.trySend({ channel: mobile, to: phone, template: 'notification', schoolId, data });
      if (PUSH_ON) for (const s of u.pushSubscriptions) await this.delivery.trySend({ channel: 'push', to: s.id, template: 'notification', schoolId, data });
    }
  }

  /** Students' own logins and/or their guardians' logins. */
  async userIdsForStudents(schoolId: string, studentIds: string[], who: { students?: boolean; guardians?: boolean }): Promise<string[]> {
    if (studentIds.length === 0) return [];
    const db = this.prisma.forSchool(schoolId);
    const [students, links] = await Promise.all([
      who.students ? db.student.findMany({ where: { id: { in: studentIds } }, select: { userId: true } }) : [],
      who.guardians ? db.studentGuardian.findMany({ where: { studentId: { in: studentIds } }, select: { guardian: { select: { userId: true } } } }) : [],
    ]);
    return [...students.map((s) => s.userId), ...links.map((l) => l.guardian.userId)].filter((x): x is string => !!x);
  }

  async notifyStudents(schoolId: string, studentIds: string[], who: { students?: boolean; guardians?: boolean }, n: NotificationInput): Promise<void> {
    try {
      await this.notify(schoolId, await this.userIdsForStudents(schoolId, studentIds, who), n);
    } catch (e) {
      this.log.error(`notifyStudents ${n.eventType} failed: ${(e as Error).message}`);
    }
  }

  // --- Web push devices ------------------------------------------------------------------

  /** Registers this browser / phone for push notifications (re-subscribing moves it to this user). */
  async subscribePush(schoolId: string, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null) {
    const db = this.prisma.forSchool(schoolId);
    // An endpoint belongs to one browser profile: drop any earlier registration of it in this school.
    await db.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
    await db.pushSubscription.create({ data: { schoolId, userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null } });
    return { subscribed: true, devices: await db.pushSubscription.count({ where: { userId } }) };
  }

  async unsubscribePush(schoolId: string, userId: string, endpoint: string) {
    const { count } = await this.prisma.forSchool(schoolId).pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { removed: count };
  }

  // --- Inbox ----------------------------------------------------------------------------

  async list(schoolId: string, userId: string, page = 1, pageSize = 30) {
    const db = this.prisma.forSchool(schoolId);
    const [items, total, unread] = await Promise.all([
      db.notification.findMany({ where: { recipientId: userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      db.notification.count({ where: { recipientId: userId } }),
      db.notification.count({ where: { recipientId: userId, readAt: null } }),
    ]);
    return { items, total, unread, page, pageSize };
  }

  async unreadCount(schoolId: string, userId: string) {
    return { unread: await this.prisma.forSchool(schoolId).notification.count({ where: { recipientId: userId, readAt: null } }) };
  }

  async markRead(schoolId: string, userId: string, id: string) {
    const r = await this.prisma.forSchool(schoolId).notification.updateMany({ where: { id, recipientId: userId, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0) {
      const exists = await this.prisma.forSchool(schoolId).notification.count({ where: { id, recipientId: userId } });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { ok: true };
  }

  async markAllRead(schoolId: string, userId: string) {
    const r = await this.prisma.forSchool(schoolId).notification.updateMany({ where: { recipientId: userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}
