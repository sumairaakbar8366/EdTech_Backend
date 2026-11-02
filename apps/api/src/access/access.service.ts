import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SchoolRoleKey } from '@schoolerp/shared';
import { ProofsService } from '../auth/proofs.service.js';
import { SocialIdentityService } from '../auth/social-identity.service.js';
import { VerificationCodesService } from '../auth/verification-codes.service.js';
import { assertAnswers, type Answers } from '../common/custom-form.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { FormsService, type Subject } from '../forms/forms.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StaffService } from '../staff/staff.service.js';
import { UsersService } from '../users/users.service.js';
import type { AccessEmailVerifyDto, AccessGoogleDto, AccessRequestDto, ApproveAccessDto, RequestableRole } from './access.dto.js';

const ROLE_LABEL: Record<RequestableRole, string> = { student: 'Student', parent: 'Parent', teacher: 'Teacher', non_teaching_staff: 'Staff member', accounts: 'Accounts officer' };
const PERSON_OF: Record<RequestableRole, 'staff' | 'guardian' | 'student'> = { student: 'student', parent: 'guardian', teacher: 'staff', non_teaching_staff: 'staff', accounts: 'staff' };

/**
 * Getting a login at a school: the person proves their email (Google or an emailed code), says who
 * they are, and an administrator decides. Only on approval is the account made and its User ID and
 * password emailed, so nobody gets in just by knowing the school's address.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: VerificationCodesService,
    private readonly proofs: ProofsService,
    private readonly social: SocialIdentityService,
    private readonly forms: FormsService,
    private readonly users: UsersService,
    private readonly staff: StaffService,
    private readonly notifications: NotificationsService,
  ) {}

  /** What the school's "Request access" page shows. */
  async publicForm(schoolId: string, schoolName: string) {
    return { schoolName, roles: Object.entries(ROLE_LABEL).filter(([k]) => k !== 'accounts').map(([key, label]) => ({ key, label })), form: await this.forms.get(schoolId, 'access') };
  }

  sendEmailCode(schoolId: string, schoolName: string, email: string) {
    return this.codes.send({ owner: `access:${schoolId}:${email}`, email, purpose: 'access', schoolId, schoolName });
  }

  async verifyEmail(schoolId: string, dto: AccessEmailVerifyDto) {
    const email = await this.codes.verify(dto.verificationId, `access:${schoolId}:${dto.email}`, dto.code);
    return { email, proof: await this.proofs.issue({ kind: 'email', value: email, method: 'email' }) };
  }

  async verifyGoogle(dto: AccessGoogleDto) {
    const who = await this.social.verify(dto.provider, dto.credential, dto.nonce);
    return { email: who.email, firstName: who.firstName, lastName: who.lastName, proof: await this.proofs.issue({ kind: 'email', value: who.email, method: 'google' }) };
  }

  async submit(schoolId: string, dto: AccessRequestDto) {
    const proof = await this.proofs.peek(dto.emailProof, 'email', dto.email);
    if (!proof || (proof.method !== 'google' && proof.method !== 'email')) throw new BadRequestException('Verify your email first (with Google or the emailed code).');
    const db = this.prisma.forSchool(schoolId);
    if (await db.user.findFirst({ where: { email: dto.email, status: { in: ['active', 'invited'] } }, select: { id: true } })) {
      throw new ConflictException('This email already has a login at this school. Sign in, or use “Forgot password”.');
    }
    // Someone who left (their login was switched off) is not given a second account: the office re-enables the old one.
    if (await db.user.findFirst({ where: { email: dto.email, status: 'disabled' }, select: { id: true } })) {
      throw new ConflictException('This email belonged to a login that the school switched off. Please ask the school office to switch it back on.');
    }
    const answers = assertAnswers(await this.forms.get(schoolId, 'access'), dto.answers);
    if (!(await this.proofs.consume([dto.emailProof]))) throw new ConflictException('This verification was already used. Verify again.');
    let request;
    try {
      request = await db.accessRequest.create({
        data: { schoolId, email: dto.email, emailMethod: proof.method, firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone ?? null, requestedRole: dto.role, note: dto.note, answers: answers as Prisma.InputJsonValue },
        select: { id: true, createdAt: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('A request from this email for this role is already waiting for the school’s approval.');
      throw e;
    }
    const admins = await db.user.findMany({ where: { status: 'active', NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: 'school_admin' } } } }, select: { id: true } });
    await this.notifications.notify(schoolId, admins.map((a) => a.id), { eventType: 'access_request', title: `Access request: ${dto.firstName} ${dto.lastName}`, body: `${ROLE_LABEL[dto.role]} · ${dto.email}. Approve to send their User ID and password.`, link: '/users-and-access?tab=requests' });
    return { id: request.id, message: 'Your request was sent to the school. When the administrator approves it, your User ID and password will be emailed to you.' };
  }

  // --- The administrator's side ---------------------------------------------------------------

  async list(schoolId: string, status?: 'pending' | 'approved' | 'rejected') {
    const rows = await this.prisma.forSchool(schoolId).accessRequest.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
    const counts = await this.prisma.forSchool(schoolId).accessRequest.groupBy({ by: ['status'], _count: true });
    return { items: rows.map((r) => ({ ...r, roleLabel: ROLE_LABEL[r.requestedRole as RequestableRole] ?? r.requestedRole })), counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) };
  }

  /** People the school already has that look like this requester (no login yet). */
  async matches(schoolId: string, id: string) {
    const r = await this.prisma.forSchool(schoolId).accessRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Request not found');
    const db = this.prisma.forSchool(schoolId);
    const type = PERSON_OF[r.requestedRole as RequestableRole];
    const name = { firstName: { contains: r.firstName, mode: 'insensitive' as const }, lastName: { contains: r.lastName, mode: 'insensitive' as const } };
    if (type === 'staff') {
      const rows = await db.employee.findMany({ where: { userId: null, OR: [{ email: r.email }, name] }, select: { id: true, firstName: true, lastName: true, email: true, designation: true }, take: 10 });
      return { type, items: rows.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, detail: e.designation, emailMatches: e.email === r.email })) };
    }
    if (type === 'guardian') {
      const rows = await db.guardian.findMany({ where: { userId: null, OR: [{ email: r.email }, name] }, select: { id: true, firstName: true, lastName: true, email: true, children: { select: { student: { select: { firstName: true } } } } }, take: 10 });
      return { type, items: rows.map((g) => ({ id: g.id, name: `${g.firstName} ${g.lastName}`, detail: g.children.length ? `Parent of ${g.children.map((c) => c.student.firstName).join(', ')}` : 'No children linked', emailMatches: g.email === r.email })) };
    }
    const rows = await db.student.findMany({ where: { userId: null, ...name }, select: { id: true, firstName: true, lastName: true, admissionNo: true }, take: 10 });
    return { type, items: rows.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, detail: `Admission no. ${s.admissionNo}`, emailMatches: false })) };
  }

  async approve(schoolId: string, actorId: string, id: string, dto: ApproveAccessDto) {
    const db = this.prisma.forSchool(schoolId);
    // Whoever flips pending → approved first owns the decision; the other sees "already decided".
    const claimed = await db.accessRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'approved', decidedBy: actorId, decidedAt: new Date() } });
    if (claimed.count === 0) {
      if (!(await db.accessRequest.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Request not found');
      throw new ConflictException('This request was already decided.');
    }
    const r = await db.accessRequest.findUniqueOrThrow({ where: { id } });
    try {
      const role = r.requestedRole as RequestableRole;
      const type = dto.personType ?? PERSON_OF[role];
      if (type !== PERSON_OF[role]) throw new BadRequestException(`A ${ROLE_LABEL[role].toLowerCase()} must be linked to a ${PERSON_OF[role]} record`);
      let personId = dto.personId;
      if (!personId) {
        if (type === 'student') throw new BadRequestException('Choose the student’s record: students are enrolled through admissions first.');
        personId = type === 'guardian' ? (await db.guardian.create({ data: { schoolId, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone ?? 'not given' } })).id : await this.createStaff(schoolId, actorId, r, role, dto.designation);
      }
      const roles: SchoolRoleKey[] | undefined = type === 'staff' ? ((dto.roles?.length ? dto.roles : [role]) as SchoolRoleKey[]) : undefined;
      const result = await this.users.grant(schoolId, actorId, { personType: type, personId, email: r.email, ...(roles && { roles }) }, r.email);
      const subject: Subject = type === 'staff' ? 'employee' : type;
      if (r.answers && Object.keys(r.answers as object).length) await this.forms.store(schoolId, subject, personId, r.answers as Answers);
      await db.accessRequest.update({ where: { id }, data: { userId: result.user.id } });
      return { id, status: 'approved' as const, user: result.user, credentialsSentTo: r.email };
    } catch (e) {
      await db.accessRequest.update({ where: { id }, data: { status: 'pending', decidedBy: null, decidedAt: null } });
      throw e;
    }
  }

  async reject(schoolId: string, actorId: string, id: string, note?: string) {
    const { count } = await this.prisma.forSchool(schoolId).accessRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'rejected', decidedBy: actorId, decidedAt: new Date(), decisionNote: note ?? null } });
    if (count === 0) throw new ConflictException('This request is not waiting for a decision.');
    return { id, status: 'rejected' as const };
  }

  private async createStaff(schoolId: string, actorId: string, r: { firstName: string; lastName: string; email: string; phone: string | null }, role: RequestableRole, designation?: string) {
    const campus = await this.prisma.forSchool(schoolId).campus.findFirst({ where: { isMain: true, isActive: true }, select: { id: true } });
    if (!campus) throw new BadRequestException('The school has no active campus yet.');
    const created = await this.staff.create(schoolId, {
      campusId: campus.id, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, staffType: role === 'teacher' ? 'teaching' : 'non_teaching',
      designation: designation ?? (role === 'teacher' ? 'Teacher' : role === 'accounts' ? 'Accounts officer' : 'Staff member'), joinDate: new Date().toISOString().slice(0, 10),
    } as never, actorId);
    return created.id;
  }
}
