import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NotificationInput {
  /** fee_paid, result_published, assignment_posted, payroll_paid, student_absent, announcement, message … */
  eventType: string;
  title: string;
  body?: string | null;
  /** In-app path inside the recipient's role area, e.g. "/fees". */
  link?: string | null;
}

/**
 * Page 11 notification service, in-app channel. Other modules call `notify…` after their own
 * transaction commits; a failure here is logged and never undoes the business action.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(schoolId: string, recipientIds: (string | null | undefined)[], n: NotificationInput): Promise<void> {
    const ids = [...new Set(recipientIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return;
    try {
      await this.prisma.forSchool(schoolId).notification.createMany({
        data: ids.map((recipientId) => ({ schoolId, recipientId, eventType: n.eventType, title: n.title, body: n.body ?? null, link: n.link ?? null })),
      });
    } catch (e) {
      this.log.error(`notify ${n.eventType} failed: ${(e as Error).message}`);
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
