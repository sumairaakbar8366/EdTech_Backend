import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SchoolRoleKey } from '@schoolerp/shared';
import { AccountsService, temporaryPassword } from '../accounts/accounts.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type { CandidatesQuery, GrantAccessDto, ListUsersQuery, PersonType } from './users.dto.js';

const STAFF_ROLES: readonly SchoolRoleKey[] = ['school_admin', 'accounts', 'teacher', 'non_teaching_staff'];
const EMPLOYED = ['active', 'on_leave'];

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  userRoles: { select: { role: { select: { key: true, name: true } } } },
  employee: { select: { id: true, employeeNo: true, designation: true, status: true } },
  guardian: { select: { id: true, _count: { select: { children: true } } } },
  student: { select: { id: true, admissionNo: true, status: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function shape(u: UserRow) {
  const { userRoles, employee, guardian, student, ...rest } = u;
  const people = [
    employee && { type: 'staff' as const, id: employee.id, detail: `${employee.designation} · ${employee.employeeNo}` },
    guardian && { type: 'guardian' as const, id: guardian.id, detail: `Parent of ${guardian._count.children} ${guardian._count.children === 1 ? 'child' : 'children'}` },
    student && { type: 'student' as const, id: student.id, detail: `Student · ${student.admissionNo}` },
  ].filter(Boolean);
  return { ...rest, roles: userRoles.map((r) => r.role), people };
}

/**
 * Users & Access (school admin): every login of the school in one place. Grant a login to an
 * existing staff member, parent or student; change roles; reset passwords; enable or disable.
 * Generated passwords are returned once and must be replaced by the user at first sign-in.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
  ) {}

  async list(schoolId: string, q: ListUsersQuery) {
    const where: Prisma.UserWhereInput = {
      ...(q.q && {
        OR: [
          { firstName: { contains: q.q, mode: 'insensitive' } },
          { lastName: { contains: q.q, mode: 'insensitive' } },
          { email: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
      ...(q.role && { userRoles: { some: { role: { key: q.role } } } }),
      ...(q.status === 'pending' ? { status: 'active', mustChangePassword: true } : q.status ? { status: q.status } : {}),
      ...(q.personType === 'staff' && { employee: { isNot: null } }),
      ...(q.personType === 'guardian' && { guardian: { isNot: null } }),
      ...(q.personType === 'student' && { student: { isNot: null } }),
    };
    const db = this.prisma.forSchool(schoolId);
    const [items, total] = await Promise.all([
      db.user.findMany({ where, select: USER_SELECT, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      db.user.count({ where }),
    ]);
    return { items: items.map(shape), total, page: q.page, pageSize: q.pageSize };
  }

  async summary(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [total, active, disabled, pending, roles] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { status: 'active' } }),
      db.user.count({ where: { status: 'disabled' } }),
      db.user.count({ where: { status: 'active', mustChangePassword: true } }),
      db.role.findMany({ where: { isSystem: true }, select: { key: true, name: true, _count: { select: { userRoles: true } } } }),
    ]);
    return { total, active, disabled, pending, byRole: roles.map((r) => ({ key: r.key, name: r.name, count: r._count.userRoles })) };
  }

  /** People who could be given a login (they do not have one yet). */
  async candidates(schoolId: string, q: CandidatesQuery) {
    const db = this.prisma.forSchool(schoolId);
    const name = q.q
      ? { OR: [{ firstName: { contains: q.q, mode: 'insensitive' as const } }, { lastName: { contains: q.q, mode: 'insensitive' as const } }] }
      : {};
    if (q.type === 'staff') {
      const rows = await db.employee.findMany({ where: { userId: null, status: { in: EMPLOYED as never }, ...name }, select: { id: true, firstName: true, lastName: true, email: true, designation: true, staffType: true }, orderBy: { firstName: 'asc' }, take: 50 });
      return rows.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, email: e.email, detail: e.designation, suggestedRoles: [e.staffType === 'teaching' ? 'teacher' : 'non_teaching_staff'] }));
    }
    if (q.type === 'guardian') {
      const rows = await db.guardian.findMany({ where: { userId: null, ...name }, select: { id: true, firstName: true, lastName: true, email: true, children: { select: { student: { select: { firstName: true } } } } }, orderBy: { firstName: 'asc' }, take: 50 });
      return rows.map((g) => ({ id: g.id, name: `${g.firstName} ${g.lastName}`, email: g.email, detail: g.children.length ? `Parent of ${g.children.map((s) => s.student.firstName).join(', ')}` : 'No children linked', suggestedRoles: ['parent'] }));
    }
    const rows = await db.student.findMany({ where: { userId: null, status: 'active', ...name }, select: { id: true, firstName: true, lastName: true, admissionNo: true }, orderBy: { firstName: 'asc' }, take: 50 });
    return rows.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, email: null, detail: `Student · ${s.admissionNo}`, suggestedRoles: ['student'] }));
  }

  /**
   * Gives a person a login. The email is generated by role ("ali.raza.teacher@demo.school") unless the
   * admin types a specific one; the person's own contact email is left as it is.
   */
  async grant(schoolId: string, dto: GrantAccessDto) {
    const { userId, password } = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const person = await this.loadPerson(tx, dto.personType, dto.personId);
      if (person.userId) throw new ConflictException('This person already has a login');
      const roles = this.rolesFor(dto.personType, dto.roles, person.suggested);
      if (dto.personType === 'staff' && !EMPLOYED.includes(person.status)) throw new BadRequestException('Only current staff can have a login');
      if (dto.personType === 'student' && person.status !== 'active') throw new BadRequestException('Only active students can have a login');
      const who = { firstName: person.firstName, lastName: person.lastName, phone: person.phone };
      let login: { userId: string; password: string };
      if (dto.email) {
        const password = temporaryPassword();
        login = { userId: await this.accounts.createLogin(tx, schoolId, { ...who, email: dto.email }, roles, password), password };
      } else login = await this.accounts.createGeneratedLogin(tx, schoolId, who, roles);
      await this.link(tx, dto.personType, dto.personId, login.userId);
      return login;
    });
    return { user: await this.one(schoolId, userId), temporaryPassword: password };
  }

  async setRoles(schoolId: string, actorId: string, id: string, roles: SchoolRoleKey[]) {
    await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, select: USER_SELECT });
      if (!user) throw new NotFoundException('User not found');
      const allowed = new Set<SchoolRoleKey>([
        ...(user.employee ? STAFF_ROLES : []),
        ...(user.guardian ? (['parent'] as const) : []),
        ...(user.student ? (['student'] as const) : []),
      ]);
      const bad = roles.filter((r) => !allowed.has(r));
      if (bad.length) throw new BadRequestException(`These roles do not fit this person: ${bad.join(', ')}`);
      const hadAdmin = user.userRoles.some((r) => r.role.key === 'school_admin');
      if (hadAdmin && !roles.includes('school_admin')) {
        if (id === actorId) throw new BadRequestException('You cannot remove your own School Admin role');
        await this.assertAnotherAdmin(tx, id);
      }
      const rows = await tx.role.findMany({ where: { key: { in: roles }, isSystem: true }, select: { id: true } });
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: rows.map((r) => ({ userId: id, roleId: r.id, schoolId })) });
    });
    return this.one(schoolId, id);
  }

  async resetPassword(schoolId: string, actorId: string, id: string) {
    if (id === actorId) throw new BadRequestException('Use "Change password" to change your own password');
    const db = this.prisma.forSchool(schoolId);
    const user = await db.user.findUnique({ where: { id }, select: { status: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'active') throw new BadRequestException('Enable the login before resetting its password');
    const password = temporaryPassword();
    await db.user.update({ where: { id }, data: { passwordHash: await this.passwords.hash(password), mustChangePassword: true } });
    await this.auth.endSessions(schoolId, id);
    return { user: await this.one(schoolId, id), temporaryPassword: password };
  }

  async setStatus(schoolId: string, actorId: string, id: string, status: 'active' | 'disabled') {
    await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, select: USER_SELECT });
      if (!user) throw new NotFoundException('User not found');
      if (user.status === status) throw new BadRequestException(`The login is already ${status}`);
      if (status === 'disabled') {
        if (id === actorId) throw new BadRequestException('You cannot disable your own login');
        if (user.userRoles.some((r) => r.role.key === 'school_admin')) await this.assertAnotherAdmin(tx, id);
      } else {
        if (user.employee && !EMPLOYED.includes(user.employee.status)) throw new BadRequestException('This staff member has left the school');
        if (user.student && user.student.status !== 'active' && !user.employee && !user.guardian) throw new BadRequestException('This student is no longer active');
      }
      await tx.user.update({ where: { id }, data: { status } });
    });
    if (status === 'disabled') await this.auth.endSessions(schoolId, id);
    return this.one(schoolId, id);
  }

  private async one(schoolId: string, id: string) {
    const u = await this.prisma.forSchool(schoolId).user.findUnique({ where: { id }, select: USER_SELECT });
    if (!u) throw new NotFoundException('User not found');
    return shape(u);
  }

  /** A school must always keep at least one active School Admin (no lock-out). */
  private async assertAnotherAdmin(tx: TenantTx, exceptId: string) {
    const others = await tx.user.count({ where: { id: { not: exceptId }, status: 'active', userRoles: { some: { role: { key: 'school_admin' } } } } });
    if (others === 0) throw new BadRequestException('The school needs at least one other active School Admin first');
  }

  private rolesFor(type: PersonType, requested: SchoolRoleKey[] | undefined, suggested: SchoolRoleKey[]): SchoolRoleKey[] {
    if (type === 'guardian') return ['parent'];
    if (type === 'student') return ['student'];
    const roles = requested?.length ? requested : suggested;
    const bad = roles.filter((r) => !STAFF_ROLES.includes(r));
    if (bad.length) throw new BadRequestException(`Staff can only have staff roles (not ${bad.join(', ')})`);
    return roles;
  }

  private async loadPerson(tx: TenantTx, type: PersonType, id: string) {
    if (type === 'staff') {
      const e = await tx.employee.findUnique({ where: { id } });
      if (!e) throw new NotFoundException('Staff member not found');
      return { ...e, suggested: [e.staffType === 'teaching' ? 'teacher' : 'non_teaching_staff'] as SchoolRoleKey[] };
    }
    if (type === 'guardian') {
      const g = await tx.guardian.findUnique({ where: { id } });
      if (!g) throw new NotFoundException('Parent not found');
      return { ...g, status: 'active', suggested: ['parent'] as SchoolRoleKey[] };
    }
    const s = await tx.student.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Student not found');
    return { ...s, email: null as string | null, phone: null as string | null, suggested: ['student'] as SchoolRoleKey[] };
  }

  private async link(tx: TenantTx, type: PersonType, id: string, userId: string) {
    if (type === 'staff') await tx.employee.update({ where: { id }, data: { userId } });
    else if (type === 'guardian') await tx.guardian.update({ where: { id }, data: { userId } });
    else await tx.student.update({ where: { id }, data: { userId } });
  }
}
