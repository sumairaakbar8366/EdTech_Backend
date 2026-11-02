import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../communication/notifications.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import { lock } from '../staff/staff.service.js';
import type { ComplaintListQuery, ComplaintMessageDto, CreateComplaintDto, PeopleQuery, SetComplaintStatusDto } from './complaints.dto.js';
import { AGAINST_KINDS, CATEGORIES, MAY_ADDRESS_PARENTS, SEVERITIES, STATUSES, STATUS_LABEL, anonymousLabel, canMove, readableScopes, scopeForSend, severityFor, type HandlerScope, type Status } from './complaints.rules.js';

const ROLE_LABEL: Record<string, string> = { principal: 'Principal', school_admin: 'Admin' };

/**
 * Complaints. Anyone at the school can raise one, openly or anonymously, about a person or the
 * school itself; the principal and the admin answer it. A complaint about the principal goes to the
 * admin and vice versa. Anonymous complaints show handlers only the kind of person who wrote them.
 * Every message, note and status change is kept as the complaint's own record.
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  meta() {
    return { categories: CATEGORIES, againstKinds: AGAINST_KINDS, severities: SEVERITIES, statuses: STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s] })) };
  }

  private async roleKeys(schoolId: string, userId: string): Promise<string[]> {
    return (await this.permissions.loadUserAccess(schoolId, userId)).roles.map((r) => r.key);
  }

  // --- Raising one ------------------------------------------------------------------------------

  async create(schoolId: string, userId: string, dto: CreateComplaintDto) {
    const roles = await this.roleKeys(schoolId, userId);
    if (dto.againstKind === 'other' && !dto.againstName) throw new BadRequestException('Say who or what the complaint is about.');
    if (dto.againstUserId && dto.againstUserId === userId) throw new BadRequestException('You cannot complain about yourself.');
    // The role shown to handlers when anonymous: the person's main (lowest-authority) role.
    const complainantRole = roles.find((r) => ['student', 'parent', 'teacher', 'non_teaching_staff', 'accounts'].includes(r)) ?? roles[0] ?? 'student';
    const sendTo = dto.sendTo ?? 'management';
    if ((sendTo === 'principal' && dto.againstKind === 'principal') || (sendTo === 'admin' && dto.againstKind === 'admin')) throw new BadRequestException('A complaint cannot be sent to the person it is about.');
    // Nobody writes a complaint to themselves.
    if ((sendTo === 'principal' && roles.includes('principal')) || (sendTo === 'admin' && (roles.includes('school_admin') || roles.some((r) => r.startsWith('delegate_'))))) throw new BadRequestException('You cannot send a complaint to yourself.');
    const scope = scopeForSend(sendTo, dto.againstKind);
    const { userIds: recipients, label: sentTo } = await this.resolveRecipients(schoolId, userId, roles, dto, sendTo);
    const year = new Date().getUTCFullYear();
    const created = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await lock(tx, `complaint:${schoolId}`);
      const n = (await tx.complaint.count({ where: { ticketNo: { startsWith: `C-${year}-` } } })) + 1;
      const c = await tx.complaint.create({
        data: {
          schoolId, ticketNo: `C-${year}-${String(n).padStart(4, '0')}`, category: dto.category, severity: severityFor(dto.category, dto.severity), subject: dto.subject, body: dto.body, anonymous: dto.anonymous,
          complainantUserId: userId, complainantRole, againstKind: dto.againstKind, againstUserId: dto.againstUserId ?? null, againstName: dto.againstName ?? null, handlerScope: scope, sentTo,
        },
      });
      if (recipients.length) await tx.complaintRecipient.createMany({ data: recipients.map((r) => ({ complaintId: c.id, userId: r, schoolId })) });
      await tx.complaintMessage.create({ data: { schoolId, complaintId: c.id, authorUserId: null, side: 'system', kind: 'event', body: dto.anonymous ? 'Complaint received (anonymous).' : 'Complaint received.' } });
      return c;
    });
    if (recipients.length) await this.notifications.notify(schoolId, recipients, { eventType: 'complaint_received', title: `A message from the school: ${created.subject}`, body: 'Open Complaints to read it and reply.', link: `/complaints?open=${created.id}&box=received` });
    await this.notifyHandlers(schoolId, scope, created.againstUserId, {
      title: `New complaint ${created.ticketNo}${created.severity === 'urgent' || created.severity === 'high' ? ` · ${created.severity}` : ''}`,
      body: `${CATEGORIES.find((c) => c.key === created.category)?.label ?? created.category}: ${created.subject}`,
    });
    return { id: created.id, ticketNo: created.ticketNo, status: created.status, anonymous: created.anonymous };
  }

  // --- The complainant's side -----------------------------------------------------------------

  async mine(schoolId: string, userId: string) {
    const rows = await this.prisma.forSchool(schoolId).complaint.findMany({
      where: { complainantUserId: userId },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true, ticketNo: true, category: true, severity: true, subject: true, anonymous: true, status: true, sentTo: true, createdAt: true, lastActivityAt: true, _count: { select: { messages: { where: { kind: 'message', side: 'handler' } } } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, replies: _count.messages }));
  }

  async mineOne(schoolId: string, userId: string, id: string) {
    const db = this.prisma.forSchool(schoolId);
    const c = await db.complaint.findFirst({ where: { id, complainantUserId: userId } });
    if (!c) throw new NotFoundException('Complaint not found');
    const messages = await db.complaintMessage.findMany({ where: { complaintId: id, kind: { in: ['message', 'event'] } }, orderBy: { createdAt: 'asc' } });
    const labels = await this.handlerLabels(schoolId, messages.map((m) => m.authorUserId));
    return {
      id: c.id, ticketNo: c.ticketNo, category: c.category, severity: c.severity, subject: c.subject, body: c.body, anonymous: c.anonymous, status: c.status, againstKind: c.againstKind, againstName: c.againstName,
      createdAt: c.createdAt, resolvedAt: c.resolvedAt, resolutionNote: c.resolutionNote, sentTo: c.sentTo,
      messages: messages.map((m) => ({ id: m.id, side: m.side, kind: m.kind, body: m.body, createdAt: m.createdAt, from: m.side === 'handler' ? labels.get(m.authorUserId ?? '') ?? 'School office' : m.side === 'recipient' ? 'Recipient' : m.side === 'complainant' ? 'You' : 'System' })),
    };
  }

  async reply(schoolId: string, userId: string, id: string, dto: ComplaintMessageDto) {
    const db = this.prisma.forSchool(schoolId);
    const c = await db.complaint.findFirst({ where: { id, complainantUserId: userId } });
    if (!c) throw new NotFoundException('Complaint not found');
    if (c.status === 'closed') throw new ConflictException('This complaint is closed. Raise a new one if there is more to say.');
    await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await tx.complaintMessage.create({ data: { schoolId, complaintId: id, authorUserId: userId, side: 'complainant', kind: 'message', body: dto.body } });
      if (c.status === 'resolved') {
        await tx.complaint.update({ where: { id }, data: { status: 'open', resolvedAt: null, resolvedBy: null, lastActivityAt: new Date() } });
        await tx.complaintMessage.create({ data: { schoolId, complaintId: id, authorUserId: null, side: 'system', kind: 'event', body: 'Reopened because the complainant replied.' } });
      } else {
        await tx.complaint.update({ where: { id }, data: { lastActivityAt: new Date() } });
      }
    });
    await this.notifyHandlers(schoolId, c.handlerScope as HandlerScope, c.againstUserId, { title: `Reply on complaint ${c.ticketNo}`, body: c.subject });
    return { ok: true };
  }

  // --- The handlers' side -----------------------------------------------------------------------

  /** The scopes this handler may read, and a filter that hides complaints about them. */
  private async visibility(schoolId: string, userId: string): Promise<Prisma.ComplaintWhereInput> {
    const scopes = readableScopes(await this.roleKeys(schoolId, userId));
    if (!scopes.length) throw new ForbiddenException('You do not handle complaints at this school');
    // "not about me" must also keep rows where againstUserId is empty (NOT (x = me) would drop NULLs).
    return { handlerScope: { in: scopes }, complainantUserId: { not: userId }, OR: [{ againstUserId: null }, { againstUserId: { not: userId } }] };
  }

  async list(schoolId: string, userId: string, q: ComplaintListQuery) {
    const visible = await this.visibility(schoolId, userId);
    const where: Prisma.ComplaintWhereInput = {
      AND: [visible, {
        ...(q.status && { status: q.status }), ...(q.category && { category: q.category }), ...(q.severity && { severity: q.severity }), ...(q.againstKind && { againstKind: q.againstKind }),
        ...(q.q && { OR: [{ subject: { contains: q.q, mode: 'insensitive' } }, { ticketNo: { contains: q.q, mode: 'insensitive' } }, { body: { contains: q.q, mode: 'insensitive' } }, { againstName: { contains: q.q, mode: 'insensitive' } }] }),
      }],
    };
    const db = this.prisma.forSchool(schoolId);
    const [items, total] = await Promise.all([
      db.complaint.findMany({ where, orderBy: [{ lastActivityAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { id: true, ticketNo: true, category: true, severity: true, subject: true, anonymous: true, complainantRole: true, againstKind: true, againstName: true, sentTo: true, status: true, createdAt: true, lastActivityAt: true } }),
      db.complaint.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async summary(schoolId: string, userId: string) {
    const visible = await this.visibility(schoolId, userId);
    const db = this.prisma.forSchool(schoolId);
    const [byStatus, urgent] = await Promise.all([
      db.complaint.groupBy({ by: ['status'], where: visible, _count: true }),
      db.complaint.count({ where: { AND: [visible, { status: { in: ['open', 'in_review'] }, severity: { in: ['high', 'urgent'] } }] } }),
    ]);
    const get = (s: Status) => byStatus.find((x) => x.status === s)?._count ?? 0;
    return { open: get('open'), inReview: get('in_review'), resolved: get('resolved'), closed: get('closed'), urgentOpen: urgent };
  }

  async one(schoolId: string, userId: string, id: string) {
    const visible = await this.visibility(schoolId, userId);
    const db = this.prisma.forSchool(schoolId);
    const c = await db.complaint.findFirst({ where: { AND: [visible, { id }] } });
    if (!c) throw new NotFoundException('Complaint not found');
    const messages = await db.complaintMessage.findMany({ where: { complaintId: id }, orderBy: { createdAt: 'asc' } });
    const authors = await this.handlerLabels(schoolId, messages.map((m) => m.authorUserId));
    let complainant: string;
    if (c.anonymous) complainant = anonymousLabel(c.complainantRole);
    else {
      const u = await db.user.findUnique({ where: { id: c.complainantUserId }, select: { firstName: true, lastName: true, loginId: true } });
      complainant = u ? `${u.firstName} ${u.lastName} (${u.loginId})` : 'A former user';
    }
    let resolvedBy: string | null = null;
    if (c.resolvedBy) resolvedBy = authors.get(c.resolvedBy) ?? (await this.handlerLabels(schoolId, [c.resolvedBy])).get(c.resolvedBy) ?? null;
    return {
      id: c.id, ticketNo: c.ticketNo, category: c.category, severity: c.severity, subject: c.subject, body: c.body, anonymous: c.anonymous, complainant, complainantRole: c.complainantRole,
      againstKind: c.againstKind, againstName: c.againstName, handlerScope: c.handlerScope, sentTo: c.sentTo, status: c.status, createdAt: c.createdAt, resolvedAt: c.resolvedAt, resolutionNote: c.resolutionNote, resolvedBy,
      messages: messages.map((m) => ({ id: m.id, side: m.side, kind: m.kind, body: m.body, createdAt: m.createdAt, from: m.side === 'handler' ? authors.get(m.authorUserId ?? '') ?? 'School office' : m.side === 'recipient' ? 'Recipient' : m.side === 'complainant' ? complainant : 'System' })),
    };
  }

  async handle(schoolId: string, userId: string, id: string, dto: ComplaintMessageDto) {
    const c = await this.loadForHandler(schoolId, userId, id);
    if (c.status === 'closed') throw new ConflictException('This complaint is closed. Reopen it to reply.');
    const internal = !!dto.internal;
    await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await tx.complaintMessage.create({ data: { schoolId, complaintId: id, authorUserId: userId, side: 'handler', kind: internal ? 'note' : 'message', body: dto.body } });
      await tx.complaint.update({ where: { id }, data: { lastActivityAt: new Date(), ...(c.status === 'open' && !internal && { status: 'in_review' as const }) } });
      if (c.status === 'open' && !internal) await tx.complaintMessage.create({ data: { schoolId, complaintId: id, authorUserId: userId, side: 'system', kind: 'event', body: 'Marked as under review.' } });
    });
    if (!internal) await this.notifications.notify(schoolId, [c.complainantUserId], { eventType: 'complaint_reply', title: `Reply on your complaint ${c.ticketNo}`, body: 'The school has answered. Open Complaints to read it.', link: `/complaints?open=${id}` });
    return { ok: true };
  }

  async setStatus(schoolId: string, userId: string, id: string, dto: SetComplaintStatusDto) {
    const c = await this.loadForHandler(schoolId, userId, id);
    if (!canMove(c.status as Status, dto.status)) throw new ConflictException(`The complaint is already ${STATUS_LABEL[c.status as Status].toLowerCase()}.`);
    const who = (await this.handlerLabels(schoolId, [userId])).get(userId) ?? 'The school';
    await this.prisma.inSchoolTransaction(schoolId, async (tx: TenantTx) => {
      const resolving = dto.status === 'resolved';
      await tx.complaint.update({ where: { id }, data: { status: dto.status, lastActivityAt: new Date(), resolvedAt: resolving ? new Date() : null, resolvedBy: resolving ? userId : null, resolutionNote: resolving ? dto.note ?? null : null } });
      await tx.complaintMessage.create({ data: { schoolId, complaintId: id, authorUserId: userId, side: 'system', kind: 'event', body: `${STATUS_LABEL[dto.status]} by ${who}.` } });
      // The explanation is optional; when written it is sent to the complainant as a reply.
      if (dto.note) await tx.complaintMessage.create({ data: { schoolId, complaintId: id, authorUserId: userId, side: 'handler', kind: 'message', body: dto.note } });
    });
    await this.notifications.notify(schoolId, [c.complainantUserId], { eventType: 'complaint_status', title: `Your complaint ${c.ticketNo} is now ${STATUS_LABEL[dto.status].toLowerCase()}`, body: dto.note ?? undefined, link: `/complaints?open=${id}` });
    return { id, status: dto.status };
  }

  private async loadForHandler(schoolId: string, userId: string, id: string) {
    const visible = await this.visibility(schoolId, userId);
    const c = await this.prisma.forSchool(schoolId).complaint.findFirst({ where: { AND: [visible, { id }] } });
    if (!c) throw new NotFoundException('Complaint not found');
    return c;
  }

  // --- Writing to parents (staff only) and reading what was sent to you -------------------------------------

  /** Parents who may be written to: those of enrolled, active students with a login. */
  private async resolveRecipients(schoolId: string, userId: string, roles: string[], dto: CreateComplaintDto, sendTo: string): Promise<{ userIds: string[]; label: string | null }> {
    if (sendTo === 'management') return { userIds: [], label: null };
    if (sendTo === 'principal') return { userIds: [], label: 'The principal' };
    if (sendTo === 'admin') return { userIds: [], label: 'The admin' };
    if (sendTo === 'teacher') {
      // Only the principal and the admin write to a teacher (for example about lateness or a complaint received).
      if (!roles.some((r) => r === 'principal' || r === 'school_admin' || r.startsWith('delegate_'))) throw new ForbiddenException('Only the principal and the admin can write to a teacher.');
      if (!dto.teacherUserId) throw new BadRequestException('Choose the teacher.');
      if (dto.teacherUserId === userId) throw new BadRequestException('You cannot send a complaint to yourself.');
      const t = await this.prisma.forSchool(schoolId).employee.findFirst({ where: { userId: dto.teacherUserId, staffType: 'teaching', status: { in: ['active', 'on_leave'] } }, select: { firstName: true, lastName: true } });
      if (!t) throw new NotFoundException('Teacher not found');
      return { userIds: [dto.teacherUserId], label: `Teacher ${t.firstName} ${t.lastName}` };
    }
    if (!roles.some((r) => (MAY_ADDRESS_PARENTS as readonly string[]).includes(r) || r.startsWith('delegate_'))) throw new ForbiddenException('Only the principal, the admin and teachers can write to parents.');
    const db = this.prisma.forSchool(schoolId);
    const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year) throw new BadRequestException('There is no current academic year.');
    const enrolled = { academicYearId: year.id, status: 'enrolled' as const, student: { status: 'active' as const } };
    let where: Prisma.StudentEnrollmentWhereInput;
    let label: string;
    if (sendTo === 'student_parents') {
      if (!dto.studentId) throw new BadRequestException('Choose the student.');
      const s = await db.student.findUnique({ where: { id: dto.studentId }, select: { firstName: true, lastName: true } });
      if (!s) throw new NotFoundException('Student not found');
      where = { ...enrolled, studentId: dto.studentId };
      label = `Parents of ${s.firstName} ${s.lastName}`;
    } else if (dto.sectionId) {
      const sec = await db.section.findUnique({ where: { id: dto.sectionId }, select: { name: true, schoolClass: { select: { name: true } } } });
      if (!sec) throw new NotFoundException('Section not found');
      where = { ...enrolled, sectionId: dto.sectionId };
      label = `Parents of ${sec.schoolClass.name} ${sec.name}`;
    } else if (dto.classId) {
      const cls = await db.schoolClass.findUnique({ where: { id: dto.classId }, select: { name: true } });
      if (!cls) throw new NotFoundException('Class not found');
      where = { ...enrolled, section: { classId: dto.classId } };
      label = `Parents of ${cls.name}`;
    } else throw new BadRequestException('Choose the class or section.');
    if (roles.includes('teacher') && !roles.some((r) => r === 'principal' || r === 'school_admin' || r.startsWith('delegate_'))) {
      // A teacher writes only to the parents of children in the sections they teach.
      const emp = await db.employee.findUnique({ where: { userId }, select: { id: true } });
      const mine = emp ? await db.teacherAssignment.findMany({ where: { employeeId: emp.id, academicYearId: year.id }, select: { sectionId: true } }) : [];
      where = { AND: [where, { sectionId: { in: mine.map((m) => m.sectionId) } }] };
    }
    const rows = await db.studentEnrollment.findMany({ where, select: { student: { select: { guardians: { select: { guardian: { select: { userId: true } } } } } } } });
    const ids = [...new Set(rows.flatMap((r) => r.student.guardians.map((g) => g.guardian.userId)).filter((x): x is string => !!x && x !== userId))];
    if (!ids.length) throw new BadRequestException('No parent in this group has a login yet (or you do not teach this group), so nobody could receive it.');
    return { userIds: ids, label };
  }

  /** Classes and sections the person may write to (a teacher: their own). */
  async groups(schoolId: string, userId: string) {
    const roles = await this.roleKeys(schoolId, userId);
    if (!roles.some((r) => (MAY_ADDRESS_PARENTS as readonly string[]).includes(r) || r.startsWith('delegate_'))) return [];
    const db = this.prisma.forSchool(schoolId);
    const all = roles.some((r) => r === 'principal' || r === 'school_admin' || r.startsWith('delegate_'));
    let sectionIds: string[] | null = null;
    if (!all) {
      const emp = await db.employee.findUnique({ where: { userId }, select: { id: true } });
      const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      sectionIds = emp && year ? (await db.teacherAssignment.findMany({ where: { employeeId: emp.id, academicYearId: year.id }, select: { sectionId: true } })).map((a) => a.sectionId) : [];
    }
    const classes = await db.schoolClass.findMany({ orderBy: { level: 'asc' }, select: { id: true, name: true, sections: { where: sectionIds ? { id: { in: sectionIds } } : {}, orderBy: { name: 'asc' }, select: { id: true, name: true } } } });
    return classes.filter((c) => c.sections.length).map((c) => ({ id: c.id, name: c.name, sections: c.sections, wholeClass: all }));
  }

  /** Complaints and notices that were sent to this person. */
  async received(schoolId: string, userId: string) {
    const rows = await this.prisma.forSchool(schoolId).complaint.findMany({
      where: { recipients: { some: { userId } } }, orderBy: { lastActivityAt: 'desc' },
      select: { id: true, ticketNo: true, category: true, severity: true, subject: true, anonymous: true, status: true, sentTo: true, createdAt: true, lastActivityAt: true },
    });
    return rows;
  }

  async receivedOne(schoolId: string, userId: string, id: string) {
    const db = this.prisma.forSchool(schoolId);
    const c = await db.complaint.findFirst({ where: { id, recipients: { some: { userId } } } });
    if (!c) throw new NotFoundException('Complaint not found');
    const messages = await db.complaintMessage.findMany({ where: { complaintId: id, kind: { in: ['message', 'event'] } }, orderBy: { createdAt: 'asc' } });
    const labels = await this.handlerLabels(schoolId, messages.map((m) => m.authorUserId));
    const sender = c.anonymous ? 'The school' : await db.user.findUnique({ where: { id: c.complainantUserId }, select: { firstName: true, lastName: true } }).then((u) => (u ? `${u.firstName} ${u.lastName}` : 'The school'));
    return {
      id: c.id, ticketNo: c.ticketNo, category: c.category, severity: c.severity, subject: c.subject, body: c.body, anonymous: c.anonymous, status: c.status, againstKind: c.againstKind, againstName: c.againstName, sentTo: c.sentTo,
      createdAt: c.createdAt, resolvedAt: c.resolvedAt, resolutionNote: c.resolutionNote, complainant: sender,
      messages: messages.map((m) => ({ id: m.id, side: m.side, kind: m.kind, body: m.body, createdAt: m.createdAt, from: m.side === 'recipient' ? (m.authorUserId === userId ? 'You' : 'Recipient') : m.side === 'handler' ? labels.get(m.authorUserId ?? '') ?? 'School office' : m.side === 'complainant' ? sender : 'System' })),
    };
  }

  async replyReceived(schoolId: string, userId: string, id: string, dto: ComplaintMessageDto) {
    const db = this.prisma.forSchool(schoolId);
    const c = await db.complaint.findFirst({ where: { id, recipients: { some: { userId } } } });
    if (!c) throw new NotFoundException('Complaint not found');
    if (c.status === 'closed') throw new ConflictException('This is closed.');
    await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await tx.complaintMessage.create({ data: { schoolId, complaintId: id, authorUserId: userId, side: 'recipient', kind: 'message', body: dto.body } });
      await tx.complaint.update({ where: { id }, data: { lastActivityAt: new Date() } });
    });
    await this.notifications.notify(schoolId, [c.complainantUserId], { eventType: 'complaint_reply', title: `Reply to ${c.ticketNo}`, body: c.subject, link: `/complaints?open=${id}` });
    await this.notifyHandlers(schoolId, c.handlerScope as HandlerScope, c.againstUserId, { title: `Parent replied on ${c.ticketNo}`, body: c.subject });
    return { ok: true };
  }

  // --- Helpers ---------------------------------------------------------------------------------------

  /** "Principal", "Admin", or a name for other handlers: complainants see the office, not a private person. */
  private async handlerLabels(schoolId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const users = await this.prisma.forSchool(schoolId).user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true, userRoles: { select: { role: { select: { key: true, name: true } } } } } });
    return new Map(users.map((u) => {
      const lead = u.userRoles.find((r) => r.role.key === 'principal' || r.role.key === 'school_admin') ?? u.userRoles[0];
      return [u.id, lead ? (ROLE_LABEL[lead.role.key] ?? lead.role.name) : `${u.firstName} ${u.lastName}`] as const;
    }));
  }

  private async notifyHandlers(schoolId: string, scope: HandlerScope, exceptUserId: string | null, n: { title: string; body: string }) {
    const roleKeys = scope === 'principal' ? ['principal'] : scope === 'admin' ? ['school_admin'] : ['principal', 'school_admin'];
    const handlers = await this.prisma.forSchool(schoolId).user.findMany({ where: { status: 'active', NOT: [{ loginId: { startsWith: 'SUP-' } }, ...(exceptUserId ? [{ id: exceptUserId }] : [])], userRoles: { some: { role: { key: { in: roleKeys } } } } }, select: { id: true } });
    await this.notifications.notify(schoolId, handlers.map((h) => h.id), { eventType: 'complaint', title: n.title, body: n.body, link: '/complaints' });
  }

  /** Who a complaint can be about, searched by name (students and parents are searched only by school staff). */
  async people(schoolId: string, userId: string, q: PeopleQuery) {
    const roles = await this.roleKeys(schoolId, userId);
    const db = this.prisma.forSchool(schoolId);
    const name = (s: string) => ({ OR: [{ firstName: { contains: s, mode: 'insensitive' as const } }, { lastName: { contains: s, mode: 'insensitive' as const } }] });
    const staffSide = roles.some((r) => !['student', 'parent'].includes(r));
    const text = q.q?.trim();
    if (q.kind === 'teacher' || q.kind === 'staff') {
      const rows = await db.employee.findMany({ where: { userId: { not: null }, status: { in: ['active', 'on_leave'] }, staffType: q.kind === 'teacher' ? 'teaching' : 'non_teaching', ...(text && name(text)) }, select: { userId: true, firstName: true, lastName: true, designation: true }, orderBy: { firstName: 'asc' }, take: 10 });
      return rows.map((e) => ({ userId: e.userId, name: `${e.firstName} ${e.lastName}`, detail: e.designation }));
    }
    if (q.kind === 'principal' || q.kind === 'admin') {
      const rows = await db.user.findMany({ where: { status: 'active', NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: q.kind === 'principal' ? 'principal' : 'school_admin' } } } }, select: { id: true, firstName: true, lastName: true }, take: 5 });
      return rows.map((u) => ({ userId: u.id, name: `${u.firstName} ${u.lastName}`, detail: q.kind === 'principal' ? 'Principal' : 'Admin' }));
    }
    if (!staffSide || !text) return [];
    if (q.kind === 'student') {
      const rows = await db.student.findMany({ where: { status: 'active', ...name(text) }, select: { id: true, userId: true, firstName: true, lastName: true, admissionNo: true, enrollments: { where: { status: 'enrolled', academicYear: { isCurrent: true } }, take: 1, select: { section: { select: { name: true, schoolClass: { select: { name: true } } } } } } }, take: 10 });
      return rows.map((s) => { const sec = s.enrollments[0]?.section; return { id: s.id, userId: s.userId, name: `${s.firstName} ${s.lastName}`, detail: `${sec ? `${sec.schoolClass.name} ${sec.name} · ` : ''}Adm. ${s.admissionNo}` }; });
    }
    if (q.kind === 'parent') {
      const rows = await db.guardian.findMany({ where: name(text), select: { userId: true, firstName: true, lastName: true }, take: 10 });
      return rows.map((g) => ({ userId: g.userId, name: `${g.firstName} ${g.lastName}`, detail: 'Parent' }));
    }
    return [];
  }

  /** Counts for the school report: raised and resolved between two dates, by category. */
  async stats(schoolId: string, from: Date, to: Date) {
    const db = this.prisma.forSchool(schoolId);
    const [raised, resolved, byCategory, open] = await Promise.all([
      db.complaint.count({ where: { createdAt: { gte: from, lt: to } } }),
      db.complaint.count({ where: { resolvedAt: { gte: from, lt: to } } }),
      db.complaint.groupBy({ by: ['category'], where: { createdAt: { gte: from, lt: to } }, _count: true, orderBy: { _count: { category: 'desc' } } }),
      db.complaint.count({ where: { status: { in: ['open', 'in_review'] } } }),
    ]);
    return { raised, resolved, open, byCategory: byCategory.map((c) => ({ category: c.category, label: CATEGORIES.find((x) => x.key === c.category)?.label ?? c.category, count: c._count })) };
  }
}
