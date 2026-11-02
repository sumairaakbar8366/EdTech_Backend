import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountsService, handover, temporaryPassword } from '../../accounts/accounts.service.js';
import { closeTenure, ensureLeaderRecord } from '../../staff/leader-record.js';
import { AuthService } from '../../auth/auth.service.js';
import { PasswordService } from '../../auth/password.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Roles the owner can see and manage per school. */
export const LEAD_ROLES = ['principal', 'school_admin'] as const;
export type LeadRole = (typeof LEAD_ROLES)[number];

const SELECT = { id: true, name: true, email: true, label: true, isPrimary: true, isActive: true, lastLoginAt: true, createdAt: true } as const;

/**
 * Owner accounts. Shared owners have the full console, labelled "Owner 2", "Owner 3"… in the logs;
 * only the main owner adds or disables them (and edits or deletes logs).
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly accounts: AccountsService,
  ) {}

  list() {
    return this.prisma.platformAdmin.findMany({ select: SELECT, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
  }

  async isPrimary(adminId: string) {
    const a = await this.prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { isPrimary: true, isActive: true } });
    return !!a?.isPrimary && a.isActive;
  }

  async add(creatorId: string, name: string, email: string) {
    if (await this.prisma.platformAdmin.findUnique({ where: { email }, select: { id: true } })) throw new ConflictException('This email already has an owner account');
    const others = await this.prisma.platformAdmin.findMany({ where: { isPrimary: false }, select: { label: true } });
    const n = Math.max(1, ...others.map((o) => Number(o.label?.replace(/\D/g, '')) || 1)) + 1;
    const password = temporaryPassword();
    const admin = await this.prisma.platformAdmin.create({
      data: { name, email, passwordHash: await this.passwords.hash(password), label: `Owner ${n}`, createdById: creatorId },
      select: SELECT,
    });
    return { admin, temporaryPassword: password };
  }

  // --- School leadership: who is principal and admin in each school ---------------------------

  /** Every school's principals, School Admins and shared admins ("Admin 2"…), without the support login. */
  async leadership() {
    const schools = await this.prisma.school.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } });
    return Promise.all(
      schools.map(async (s) => {
        const users = await this.prisma.forSchool(s.id).user.findMany({
          where: { NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { OR: [{ key: { in: [...LEAD_ROLES] } }, { key: { startsWith: 'delegate_' } }] } } } },
          select: { id: true, firstName: true, lastName: true, email: true, loginId: true, status: true, lastLoginAt: true, userRoles: { select: { role: { select: { key: true, name: true } } } } },
          orderBy: { firstName: 'asc' },
        });
        const people = users.flatMap((u) =>
          u.userRoles
            .filter((r) => (LEAD_ROLES as readonly string[]).includes(r.role.key) || r.role.key.startsWith('delegate_'))
            .map((r) => ({ userId: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email, loginId: u.loginId, status: u.status, lastLoginAt: u.lastLoginAt, role: r.role.key, roleName: r.role.name })),
        );
        return { school: s, people };
      }),
    );
  }

  /** Makes a new principal or School Admin login in a school; the temporary password is returned once. */
  async addLeader(schoolId: string, role: LeadRole, person: { firstName: string; lastName: string; email: string }) {
    if (!(await this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } }))) throw new NotFoundException('School not found');
    const login = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const l = await this.accounts.createLogin(tx, schoolId, { ...person, emailVerified: false }, [role]);
      // Principals and admins are staff: the principal handles their leave, salary and clearance.
      await ensureLeaderRecord(tx, schoolId, l.userId, role);
      return l;
    });
    await this.accounts.announce(schoolId, [login]);
    return { temporaryPassword: login.password, credentials: handover(login) };
  }

  /**
   * Takes the principal / School Admin role away. A login left without any role is disabled and signed
   * out. A school always keeps at least one active School Admin.
   */
  async removeLeader(schoolId: string, userId: string, role: LeadRole) {
    const disabled = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { loginId: true, userRoles: { select: { roleId: true, role: { select: { key: true } } } } } });
      if (!user || user.loginId.startsWith('SUP-')) throw new NotFoundException('Login not found');
      const held = user.userRoles.find((r) => r.role.key === role);
      if (!held) throw new BadRequestException(`This login is not a ${role === 'principal' ? 'principal' : 'School Admin'}`);
      if (role === 'school_admin') {
        const others = await tx.user.count({ where: { id: { not: userId }, status: 'active', NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: 'school_admin' } } } } });
        if (!others) throw new BadRequestException('This is the school\'s only School Admin. Add another admin first.');
      }
      await closeTenure(tx, schoolId, userId, { action: 'role_removed', role, reason: 'Removed by the platform owner' });
      await tx.userRole.delete({ where: { userId_roleId: { userId, roleId: held.roleId } } });
      if (user.userRoles.length === 1) {
        await tx.user.update({ where: { id: userId }, data: { status: 'disabled' } });
        return true;
      }
      return false;
    });
    if (disabled) await this.auth.endSessions(schoolId, userId);
    return { ok: true, disabled };
  }

  async setActive(id: string, active: boolean) {
    const a = await this.prisma.platformAdmin.findUnique({ where: { id }, select: { isPrimary: true } });
    if (!a) throw new NotFoundException('Owner account not found');
    if (a.isPrimary) throw new BadRequestException('The main owner account cannot be disabled here');
    const admin = await this.prisma.platformAdmin.update({ where: { id }, data: { isActive: active }, select: SELECT });
    if (!active) await this.auth.endPlatformSessions(id);
    return admin;
  }
}
