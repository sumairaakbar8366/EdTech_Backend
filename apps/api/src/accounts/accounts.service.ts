import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { SchoolRoleKey } from '@schoolerp/shared';
import { randomInt } from 'node:crypto';
import { PasswordService } from '../auth/password.service.js';
import type { TenantTx } from '../prisma/prisma.service.js';

export interface NewAccount {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
}

/** No 0/O, 1/l/I: the password is read out or typed from a printout. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** A 14-character temporary password like "Kp7m-Qx4t-Rv9w" (about 70 bits). */
export function temporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

/** The part of a generated login email that says what the account is for. */
const ROLE_SUFFIX: Record<SchoolRoleKey, string> = {
  school_admin: 'admin',
  accounts: 'accounts',
  teacher: 'teacher',
  non_teaching_staff: 'staff',
  parent: 'parent',
  student: 'student',
};

/** "Tehmina Aslam" → "tehmina.aslam" (accents dropped, anything else removed). */
function emailName(firstName: string, lastName: string): string {
  const part = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  return [part(firstName), part(lastName)].filter(Boolean).join('.') || 'user';
}

export interface GeneratedLogin {
  userId: string;
  email: string;
  password: string;
}

/** Creates school logins (users + system roles) for staff, parents and students. */
@Injectable()
export class AccountsService {
  constructor(private readonly passwords: PasswordService) {}

  /**
   * Passwords chosen by someone else (an administrator) are temporary: the person must replace it at
   * first sign-in. Only development seeding passes `temporary: false`.
   */
  async createLogin(tx: TenantTx, schoolId: string, person: NewAccount, roles: readonly SchoolRoleKey[], password: string, temporary = true): Promise<string> {
    const email = person.email.trim().toLowerCase();
    if (await tx.user.findUnique({ where: { schoolId_email: { schoolId, email } }, select: { id: true } })) {
      throw new ConflictException(`A login with the email ${email} already exists in this school`);
    }
    const roleRows = await tx.role.findMany({ where: { key: { in: [...roles] }, isSystem: true }, select: { id: true } });
    if (roleRows.length !== new Set(roles).size) throw new BadRequestException('One or more roles do not exist');

    const user = await tx.user.create({
      data: {
        schoolId,
        email,
        passwordHash: await this.passwords.hash(password),
        mustChangePassword: temporary,
        firstName: person.firstName,
        lastName: person.lastName,
        phone: person.phone ?? null,
      },
    });
    await tx.userRole.createMany({ data: roleRows.map((r) => ({ userId: user.id, roleId: r.id, schoolId })) });
    return user.id;
  }

  /**
   * A school-issued login email by role, e.g. "tehmina.aslam.teacher@demo.school"; personal emails stay
   * on the person's record as contact details. A number is added when the name is already taken.
   */
  async loginEmail(tx: TenantTx, schoolId: string, firstName: string, lastName: string, role: SchoolRoleKey): Promise<string> {
    const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { slug: true } });
    const base = `${emailName(firstName, lastName)}.${ROLE_SUFFIX[role]}`;
    const domain = `@${school.slug}.school`;
    const taken = new Set(
      (await tx.user.findMany({ where: { email: { startsWith: base } }, select: { email: true } })).map((u) => u.email),
    );
    for (let n = 1; ; n++) {
      const email = `${base}${n === 1 ? '' : n}${domain}`;
      if (!taken.has(email)) return email;
    }
  }

  /** Creates a login with a generated role-based email and a temporary password (shown once). */
  async createGeneratedLogin(
    tx: TenantTx,
    schoolId: string,
    person: Omit<NewAccount, 'email'>,
    roles: readonly SchoolRoleKey[],
  ): Promise<GeneratedLogin> {
    const primary = (['teacher', 'accounts', 'school_admin', 'non_teaching_staff', 'parent', 'student'] as const).find((r) => roles.includes(r)) ?? roles[0];
    const email = await this.loginEmail(tx, schoolId, person.firstName, person.lastName, primary);
    const password = temporaryPassword();
    const userId = await this.createLogin(tx, schoolId, { ...person, email }, roles, password);
    return { userId, email, password };
  }
}
