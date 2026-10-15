import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import type { SchoolRoleKey } from '@schoolerp/shared';
import { randomInt } from 'node:crypto';
import { PasswordService } from '../auth/password.service.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import { WebUrls } from '../delivery/web-urls.service.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';

export interface NewAccount {
  firstName: string;
  lastName: string;
  phone?: string | null;
  /** The person's own email (contact, OTP, password reset). Optional: young students may have none. */
  email?: string | null;
  /** True when the address was just confirmed with an emailed code. */
  emailVerified?: boolean;
  /** Joining / admission year for the User ID. Defaults to the current year. */
  year?: number;
}

/** No 0/O, 1/l/I: the password is read out or typed from a printout. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** A 14-character temporary password like "Kp7m-Qx4t-Rv9w" (about 70 bits). */
export function temporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

/** User ID prefix by the account's main role. */
export const LOGIN_PREFIX: Record<SchoolRoleKey, string> = {
  school_admin: 'ADM',
  accounts: 'ACC',
  teacher: 'TCH',
  non_teaching_staff: 'STF',
  parent: 'PAR',
  student: 'STU',
};
const PRIORITY: readonly SchoolRoleKey[] = ['school_admin', 'accounts', 'teacher', 'non_teaching_staff', 'parent', 'student'];

/** "TCH", 2026, 7 → "TCH-2026-0007" (the database checks the same format). */
export const formatLoginId = (prefix: string, year: number, seq: number) => `${prefix}-${year}-${String(seq).padStart(4, '0')}`;

/** Normalises what people type: " tch-2026-0007 " → "TCH-2026-0007". */
export const normaliseLoginId = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '');

export interface GeneratedLogin {
  userId: string;
  loginId: string;
  /** Temporary password: shown once to the administrator, replaced by the person at first sign-in. */
  password: string;
  name: string;
  /** The main role (decides the User ID prefix). */
  role: SchoolRoleKey;
  email: string | null;
  emailVerified: boolean;
}

/** What the administrator sees once after creating a login. */
export const handover = (l: GeneratedLogin) => ({ name: l.name, role: l.role, loginId: l.loginId, email: l.email, emailVerified: l.emailVerified, password: l.password });

/** Creates school logins (users + system roles + User ID) for staff, parents and students. */
@Injectable()
export class AccountsService {
  private readonly log = new Logger(AccountsService.name);

  constructor(
    private readonly passwords: PasswordService,
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly urls: WebUrls,
    config: ConfigService<Env, true>,
  ) {
    this.verificationOff = config.get('EMAIL_VERIFICATION', { infer: true }) === 'off';
    this.google = !!config.get('GOOGLE_CLIENT_ID', { infer: true })?.trim();
  }

  /** EMAIL_VERIFICATION=off (testing): every new login gets its password by email. */
  private readonly verificationOff: boolean;
  /** "Continue with Google" is offered on the sign-in page. */
  private readonly google: boolean;

  /**
   * The next User ID for a prefix and year, e.g. TCH-2026-0008: one counter for every school, so a
   * User ID is unique on the whole platform. The counter row stays locked until commit, so two
   * logins created at once never get the same number. The caller creates the user and then records
   * the ID with `recordLoginId`.
   */
  async nextLoginId(tx: TenantTx, _schoolId: string, prefix: string, year: number) {
    const [row] = await tx.$queryRaw<{ last_seq: number }[]>`
      INSERT INTO login_id_counters (prefix, year, last_seq) VALUES (${prefix}, ${year}, 1)
      ON CONFLICT (prefix, year) DO UPDATE SET last_seq = login_id_counters.last_seq + 1
      RETURNING last_seq`;
    const seq = row!.last_seq;
    return { loginId: formatLoginId(prefix, year, seq), prefix, year, seq };
  }

  /**
   * Creates a login with a new User ID and a temporary password (or the given one). Passwords chosen
   * by someone else must be replaced at first sign-in; only development seeding passes `temporary: false`.
   * Call `announce()` after the transaction commits to email the person.
   */
  async createLogin(
    tx: TenantTx,
    schoolId: string,
    person: NewAccount,
    roles: readonly SchoolRoleKey[],
    opts: { password?: string; temporary?: boolean } = {},
  ): Promise<GeneratedLogin> {
    const roleRows = await tx.role.findMany({ where: { key: { in: [...roles] }, isSystem: true }, select: { id: true } });
    if (roleRows.length !== new Set(roles).size || roles.length === 0) throw new BadRequestException('One or more roles do not exist');
    const email = person.email?.trim().toLowerCase() || null;
    if (!email && !roles.every((r) => r === 'student')) {
      throw new BadRequestException(`${person.firstName} ${person.lastName} needs an email address: people sign in with their own email.`);
    }
    if (email) {
      const taken = await tx.user.findFirst({ where: { email }, select: { loginId: true, firstName: true, lastName: true } });
      if (taken) throw new ConflictException(`${email} already signs in as ${taken.firstName} ${taken.lastName} (${taken.loginId}). Use another email, or give that login the extra role in Users & Access.`);
    }
    const password = opts.password ?? temporaryPassword();
    const primary = PRIORITY.find((r) => roles.includes(r))!;
    const year = person.year ?? new Date().getUTCFullYear();

    const id = await this.nextLoginId(tx, schoolId, LOGIN_PREFIX[primary], year);
    const user = await tx.user.create({
      data: {
        schoolId,
        loginId: id.loginId,
        email,
        emailVerifiedAt: email && person.emailVerified ? new Date() : null,
        passwordHash: await this.passwords.hash(password),
        mustChangePassword: opts.temporary ?? true,
        firstName: person.firstName,
        lastName: person.lastName,
        phone: person.phone ?? null,
      },
      select: { id: true },
    });
    await tx.loginId.create({ data: { schoolId, ...id, userId: user.id } });
    await tx.userRole.createMany({ data: roleRows.map((r) => ({ userId: user.id, roleId: r.id, schoolId })) });
    return { userId: user.id, loginId: id.loginId, password, name: `${person.firstName} ${person.lastName}`, role: primary, email, emailVerified: !!(email && person.emailVerified) };
  }

  /**
   * Emails each new login holder their User ID (after the transaction committed). The temporary
   * password goes in the email only when the address was verified with a code (always while
   * EMAIL_VERIFICATION=off); otherwise the administrator hands it over. Never throws.
   */
  async announce(schoolId: string, logins: (GeneratedLogin | null | undefined)[]): Promise<void> {
    const list = logins.filter((l): l is GeneratedLogin => !!l?.email);
    if (!list.length) return;
    try {
      const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, slug: true } });
      for (const l of list) {
        await this.delivery.trySend({
          channel: 'email',
          to: l.email!,
          template: 'account_created',
          schoolId,
          data: { schoolName: school.name, name: l.name, loginId: l.loginId, signInUrl: this.urls.school(school.slug, '/login'), ...((l.emailVerified || this.verificationOff) && { temporaryPassword: l.password }), google: this.google },
        });
      }
    } catch (e) {
      this.log.error(`announce logins failed: ${(e as Error).message}`);
    }
  }
}
