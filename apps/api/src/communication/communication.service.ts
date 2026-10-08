import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import type { AnnouncementDto, StartThreadDto } from './communication.dto.js';
import { NotificationsService } from './notifications.service.js';

type Auth = { schoolId: string; userId: string };

export interface Contact {
  userId: string;
  name: string;
  /** teacher | guardian */
  kind: 'teacher' | 'guardian';
  detail: string;
}

/** In-app paths of the messages page in each side's role area. */
const MESSAGES_LINK = { teacher: '/messages', guardian: '/teacher-communication' } as const;

/** Announcements (school-wide, by role) and parent ↔ teacher message threads (page 11 / 14). */
@Injectable()
export class CommunicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Announcements ------------------------------------------------------------------

  /** Announcements addressed to the user's roles (or to everyone); administrators see all. */
  async listAnnouncements(auth: Auth) {
    const access = await this.permissions.loadUserAccess(auth.schoolId, auth.userId);
    const keys = access.roles.map((r) => r.key);
    const isAdmin = keys.includes('school_admin');
    return this.prisma.forSchool(auth.schoolId).announcement.findMany({
      where: isAdmin ? {} : { OR: [{ targetRoles: { isEmpty: true } }, { targetRoles: { hasSome: keys } }] },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });
  }

  async createAnnouncement(auth: Auth, dto: AnnouncementDto) {
    const db = this.prisma.forSchool(auth.schoolId);
    const targetRoles = dto.targetRoles ?? [];
    const announcement = await db.announcement.create({ data: { schoolId: auth.schoolId, title: dto.title, body: dto.body, targetRoles, createdBy: auth.userId } });
    const recipients = await db.user.findMany({
      where: { status: 'active', ...(targetRoles.length ? { userRoles: { some: { role: { key: { in: targetRoles } } } } } : {}) },
      select: { id: true },
    });
    await this.notifications.notify(auth.schoolId, recipients.map((u) => u.id), { eventType: 'announcement', title: dto.title, body: dto.body.slice(0, 280), link: '/notifications' });
    return { ...announcement, recipients: recipients.length };
  }

  async deleteAnnouncement(auth: Auth, id: string) {
    const r = await this.prisma.forSchool(auth.schoolId).announcement.deleteMany({ where: { id } });
    if (r.count === 0) throw new NotFoundException('Announcement not found');
    return { ok: true };
  }

  // --- Messages -----------------------------------------------------------------------

  /**
   * Who the user may start a conversation with, per student: a parent sees the teachers of each
   * child's current section; a teacher sees the guardians of the students they teach this year.
   */
  async contacts(auth: Auth): Promise<{ studentId: string; studentName: string; section: string | null; contacts: Contact[] }[]> {
    const db = this.prisma.forSchool(auth.schoolId);
    const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year) return [];
    const [guardian, employee] = await Promise.all([
      db.guardian.findUnique({ where: { userId: auth.userId }, select: { id: true } }),
      db.employee.findUnique({ where: { userId: auth.userId }, select: { id: true } }),
    ]);
    const out = new Map<string, { studentId: string; studentName: string; section: string | null; contacts: Contact[] }>();

    if (guardian) {
      const children = await db.studentGuardian.findMany({
        where: { guardianId: guardian.id },
        select: { student: { select: { id: true, firstName: true, lastName: true, enrollments: { where: { academicYearId: year.id, status: 'enrolled' }, select: { section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } } } } } } },
      });
      for (const { student: s } of children) {
        const sec = s.enrollments[0]?.section;
        const entry = { studentId: s.id, studentName: `${s.firstName} ${s.lastName}`, section: sec ? `${sec.schoolClass.name} ${sec.name}` : null, contacts: [] as Contact[] };
        if (sec) {
          const teachers = await db.teacherAssignment.findMany({
            where: { academicYearId: year.id, sectionId: sec.id, employee: { userId: { not: null } } },
            select: { subject: { select: { name: true } }, employee: { select: { userId: true, firstName: true, lastName: true } } },
          });
          const byUser = new Map<string, Contact>();
          for (const t of teachers) {
            const prev = byUser.get(t.employee.userId!);
            byUser.set(t.employee.userId!, { userId: t.employee.userId!, name: `${t.employee.firstName} ${t.employee.lastName}`, kind: 'teacher', detail: prev ? `${prev.detail}, ${t.subject.name}` : t.subject.name });
          }
          entry.contacts = [...byUser.values()];
        }
        out.set(s.id, entry);
      }
    }

    // School Admins can write to the parents of any enrolled student; teachers to their own sections'.
    const isAdmin = (await db.userRole.count({ where: { userId: auth.userId, role: { key: 'school_admin' } } })) > 0;
    if (employee || isAdmin) {
      const sections = isAdmin ? [] : await db.teacherAssignment.findMany({ where: { employeeId: employee!.id, academicYearId: year.id }, select: { sectionId: true } });
      const enrolments = await db.studentEnrollment.findMany({
        where: { academicYearId: year.id, status: 'enrolled', ...(!isAdmin && { sectionId: { in: [...new Set(sections.map((x) => x.sectionId))] } }) },
        select: {
          section: { select: { name: true, schoolClass: { select: { name: true } } } },
          student: { select: { id: true, firstName: true, lastName: true, guardians: { select: { relationship: true, guardian: { select: { userId: true, firstName: true, lastName: true } } } } } },
        },
        orderBy: [{ student: { firstName: 'asc' } }],
      });
      for (const e of enrolments) {
        const contacts = e.student.guardians
          .filter((g) => g.guardian.userId)
          .map((g) => ({ userId: g.guardian.userId!, name: `${g.guardian.firstName} ${g.guardian.lastName}`, kind: 'guardian' as const, detail: g.relationship }));
        if (contacts.length) out.set(e.student.id, { studentId: e.student.id, studentName: `${e.student.firstName} ${e.student.lastName}`, section: `${e.section.schoolClass.name} ${e.section.name}`, contacts });
      }
    }
    return [...out.values()];
  }

  async listThreads(auth: Auth) {
    const db = this.prisma.forSchool(auth.schoolId);
    const threads = await db.messageThread.findMany({
      where: { participants: { some: { userId: auth.userId } } },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        participants: { select: { userId: true, lastReadAt: true, user: { select: { firstName: true, lastName: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, createdAt: true, senderId: true } },
      },
    });
    return threads.map((t) => {
      const me = t.participants.find((p) => p.userId === auth.userId);
      return {
        id: t.id,
        subject: t.subject,
        student: t.student,
        lastMessageAt: t.lastMessageAt,
        lastMessage: t.messages[0] ?? null,
        others: t.participants.filter((p) => p.userId !== auth.userId).map((p) => ({ userId: p.userId, name: `${p.user.firstName} ${p.user.lastName}` })),
        unread: !me?.lastReadAt || me.lastReadAt < t.lastMessageAt,
      };
    });
  }

  async startThread(auth: Auth, dto: StartThreadDto) {
    const allowed = (await this.contacts(auth)).find((c) => c.studentId === dto.studentId)?.contacts.find((c) => c.userId === dto.recipientId);
    if (!allowed) throw new ForbiddenException('You can only message the teachers or parents of your own students');
    const thread = await this.prisma.inSchoolTransaction(auth.schoolId, async (tx) => {
      const t = await tx.messageThread.create({ data: { schoolId: auth.schoolId, studentId: dto.studentId, subject: dto.subject, createdBy: auth.userId } });
      await tx.messageThreadParticipant.createMany({
        data: [
          { threadId: t.id, schoolId: auth.schoolId, userId: auth.userId, lastReadAt: new Date() },
          { threadId: t.id, schoolId: auth.schoolId, userId: dto.recipientId },
        ],
      });
      await tx.message.create({ data: { schoolId: auth.schoolId, threadId: t.id, senderId: auth.userId, body: dto.body } });
      return t;
    });
    await this.notifications.notify(auth.schoolId, [dto.recipientId], { eventType: 'message', title: `New message: ${dto.subject}`, body: dto.body.slice(0, 280), link: `${MESSAGES_LINK[allowed.kind]}?thread=${thread.id}` });
    return thread;
  }

  async getThread(auth: Auth, id: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const thread = await db.messageThread.findFirst({
      where: { id, participants: { some: { userId: auth.userId } } },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        participants: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
        messages: { orderBy: { createdAt: 'asc' }, select: { id: true, body: true, createdAt: true, senderId: true } },
      },
    });
    if (!thread) throw new NotFoundException('Conversation not found');
    await db.messageThreadParticipant.updateMany({ where: { threadId: id, userId: auth.userId }, data: { lastReadAt: new Date() } });
    const names = new Map(thread.participants.map((p) => [p.userId, `${p.user.firstName} ${p.user.lastName}`]));
    return {
      id: thread.id,
      subject: thread.subject,
      student: thread.student,
      participants: thread.participants.map((p) => ({ userId: p.userId, name: names.get(p.userId)! })),
      messages: thread.messages.map((m) => ({ ...m, senderName: names.get(m.senderId) ?? 'Former participant', mine: m.senderId === auth.userId })),
    };
  }

  async reply(auth: Auth, id: string, body: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const thread = await db.messageThread.findFirst({ where: { id, participants: { some: { userId: auth.userId } } }, include: { participants: { select: { userId: true } } } });
    if (!thread) throw new NotFoundException('Conversation not found');
    const now = new Date();
    const message = await this.prisma.inSchoolTransaction(auth.schoolId, async (tx) => {
      const m = await tx.message.create({ data: { schoolId: auth.schoolId, threadId: id, senderId: auth.userId, body } });
      await tx.messageThread.update({ where: { id }, data: { lastMessageAt: now } });
      await tx.messageThreadParticipant.updateMany({ where: { threadId: id, userId: auth.userId }, data: { lastReadAt: now } });
      return m;
    });
    const others = thread.participants.map((p) => p.userId).filter((u) => u !== auth.userId);
    const teachers = new Set((await db.employee.findMany({ where: { userId: { in: others } }, select: { userId: true } })).map((e) => e.userId));
    for (const u of others) {
      await this.notifications.notify(auth.schoolId, [u], { eventType: 'message', title: `Reply: ${thread.subject}`, body: body.slice(0, 280), link: `${teachers.has(u) ? MESSAGES_LINK.teacher : MESSAGES_LINK.guardian}?thread=${id}` });
    }
    return message;
  }
}
