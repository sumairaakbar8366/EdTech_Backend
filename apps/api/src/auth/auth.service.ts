import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { normaliseLoginId } from '../accounts/accounts.service.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import { OwnerAlertsService } from '../delivery/owner-alerts.service.js';
import { WebUrls } from '../delivery/web-urls.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import { SocialIdentityService, type SocialProvider } from './social-identity.service.js';
import { LoginEventsService, type LoginContext } from './login-events.service.js';
import { LoginTicketService } from './login-ticket.service.js';
import { PasswordResetService, RESET_TTL_MINUTES } from './password-reset.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService, type TokenSubject } from './refresh-token.service.js';
import { VerificationCodesService } from './verification-codes.service.js';
import type { SchoolScopedClient } from '../prisma/prisma.service.js';

export type AccessTokenPayload =
  | { sub: string; scope: 'platform' }
  /** `pwc`: the password was set by an administrator and must be replaced before anything else. */
  | { sub: string; scope: 'school'; sid: string; pwc?: true; sup?: string; supn?: string };

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const INVALID_CREDENTIALS = 'Invalid email or password';

const INVALID_SCHOOL_CREDENTIALS = 'Invalid email (or User ID) or password';

const ROLE_LABEL: Record<string, string> = { principal: 'Principal', school_admin: 'Admin', accounts: 'Accounts', teacher: 'Teacher', non_teaching_staff: 'Staff', parent: 'Parent', student: 'Student' };

/** A person the main /login (or Google) matched: the owner, or a user at one school. */
type SignInCandidate = { kind: 'platform'; adminId: string; name: string } | { kind: 'school'; school: { id: string; slug: string; name: string }; userId: string };

/** Where a main-site sign-in continues: straight into one account, or a choice of schools. */
export type SignInOutcome = { continueUrl: string } | { choose: { school: string; name: string }[] };
/** Google sign-in on the main site with no account yet: the person is offered the free trial instead. */
export type SocialSignInOutcome = SignInOutcome | { noAccount: { email: string } };

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private readonly accessTtl: number;

  /** EMAIL_VERIFICATION=off (testing only): nobody is asked to confirm their email after signing in. */
  private readonly emailCheckOff: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly permissions: PermissionService,
    private readonly codes: VerificationCodesService,
    private readonly resets: PasswordResetService,
    private readonly tickets: LoginTicketService,
    private readonly events: LoginEventsService,
    private readonly delivery: DeliveryService,
    private readonly urls: WebUrls,
    private readonly social: SocialIdentityService,
    private readonly alerts: OwnerAlertsService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.emailCheckOff = config.get('EMAIL_VERIFICATION', { infer: true }) === 'off';
  }

  /**
   * Login is tenant-aware. On a school's host people sign in with their own email (or, for a student
   * without one, their User ID); on the platform host the owner signs in with an email. Every attempt
   * is recorded in the login history.
   */
  async login(tenant: TenantContext, identifier: string, password: string, ctx: LoginContext = {}): Promise<IssuedTokens> {
    if (tenant.kind === 'platform') {
      const admin = await this.prisma.platformAdmin.findUnique({ where: { email: identifier.toLowerCase() } });
      const ok = await this.passwords.verify(admin?.passwordHash, password);
      if (!admin || !ok || !admin.isActive) {
        await this.events.record({ ...ctx, platformAdminId: admin?.id, identifier, name: admin?.name, success: false, reason: !admin ? 'unknown account' : !ok ? 'wrong password' : 'disabled' });
        throw new UnauthorizedException(INVALID_CREDENTIALS);
      }
      await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
      await this.events.record({ ...ctx, platformAdminId: admin.id, identifier, name: `${admin.name} (${admin.label ?? 'Owner'})`, roles: ['platform_owner'], success: true });
      return this.issue({ scope: 'platform', sub: admin.id });
    }

    const db = this.prisma.forSchool(tenant.schoolId);
    const byEmail = identifier.includes('@');
    const user = await db.user.findFirst({
      where: byEmail ? { email: identifier.trim().toLowerCase() } : { loginId: normaliseLoginId(identifier) },
      include: { userRoles: { select: { role: { select: { key: true } } } } },
    });
    const ok = await this.passwords.verify(user?.passwordHash, password);
    const who = user && { userId: user.id, loginId: user.loginId, name: `${user.firstName} ${user.lastName}`, roles: user.userRoles.map((r) => r.role.key) };
    if (!user || !ok || user.status !== 'active') {
      await this.events.record({ ...ctx, ...who, schoolId: tenant.schoolId, identifier, success: false, reason: !user ? 'unknown account' : !ok ? 'wrong password' : 'disabled' });
      throw new UnauthorizedException(INVALID_SCHOOL_CREDENTIALS);
    }
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.events.record({ ...ctx, ...who, schoolId: tenant.schoolId, identifier, success: true });
    return this.issue({ scope: 'school', sub: user.id, sid: tenant.schoolId }, user.mustChangePassword);
  }

  /**
   * The single /login on the main domain. The owner (platform admin email) goes to the console; a
   * school user goes to their school. A User ID like ADM-2026-0001 exists in every school and an
   * email may be used at several, so every active school is checked for this identifier with this
   * password: one match continues at once, several are returned to choose from (`school` picks one).
   */
  async universalLogin(identifier: string, password: string, school: string | undefined, ctx: LoginContext = {}, remember = false): Promise<SignInOutcome> {
    const id = identifier.trim();
    const byEmail = id.includes('@');
    const candidates: SignInCandidate[] = [];
    if (byEmail && (!school || school === 'console')) {
      const admin = await this.prisma.platformAdmin.findUnique({ where: { email: id.toLowerCase() } });
      if (admin?.isActive && (await this.passwords.verify(admin.passwordHash, password))) candidates.push({ kind: 'platform', adminId: admin.id, name: admin.name });
    }
    if (school !== 'console') {
      const found = await this.findInSchools(school, (db) =>
        db.user.findFirst({ where: { ...(byEmail ? { email: id.toLowerCase() } : { loginId: normaliseLoginId(id) }), status: 'active' }, select: { id: true, passwordHash: true } }),
      );
      for (const f of found) if (await this.passwords.verify(f.user.passwordHash, password)) candidates.push({ kind: 'school', school: f.school, userId: f.user.id });
    }
    if (!candidates.length) {
      await this.events.record({ ...ctx, identifier: id, success: false, reason: 'no matching account (main /login)' });
      throw new UnauthorizedException(INVALID_SCHOOL_CREDENTIALS);
    }
    return this.signInOutcome(candidates, 'login', remember);
  }

  /**
   * "Continue with Google": the Google sign-in happens on the main site (Google only accepts the
   * registered address). The Google-verified email is looked up in the given school, or in every
   * school; one match continues, several are returned to choose from. Within a school the email
   * must belong to exactly one person (a young student may share a parent's address).
   */
  async providerTicket(slug: string | undefined, provider: SocialProvider, credential: string, nonce: string, ctx: LoginContext = {}): Promise<SocialSignInOutcome> {
    const who = await this.social.verify(provider, credential, nonce);
    const found = await this.findInSchools(slug, (db) => db.user.findMany({ where: { email: who.email, status: 'active' }, select: { id: true, emailVerifiedAt: true }, take: 2 }));
    const shared = found.filter((f) => f.user.length > 1);
    const candidates: SignInCandidate[] = found.filter((f) => f.user.length === 1).map((f) => ({ kind: 'school', school: f.school, userId: f.user[0]!.id }));
    if (!candidates.length) {
      await this.events.record({ ...ctx, schoolId: found[0]?.school.id, identifier: who.email, method: provider, success: false, reason: shared.length ? 'email shared by several accounts' : 'unknown account' });
      // A new visitor on the main site: no error, they go on to start a free trial (with an emailed code).
      if (!slug && !shared.length) return { noAccount: { email: who.email } };
      throw new UnauthorizedException(
        shared.length
          ? 'Several accounts at your school use this email. Sign in with your User ID and password.'
          : `This school has no account with ${who.email}. Ask the school office to add this email, or sign in with your User ID.`,
      );
    }
    // Google has verified the address, which is what the email check would prove.
    for (const c of candidates) {
      if (c.kind !== 'school') continue;
      const db = this.prisma.forSchool(c.school.id);
      await db.user.updateMany({ where: { id: c.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
    }
    return this.signInOutcome(candidates, provider);
  }

  /** Runs `find` in each active school (or the one named): RLS only shows one school at a time. */
  private async findInSchools<T>(slug: string | undefined, find: (db: SchoolScopedClient) => Promise<T | null>): Promise<{ school: { id: string; slug: string; name: string }; user: NonNullable<T> }[]> {
    const schools = await this.prisma.school.findMany({ where: { status: 'active', ...(slug && { slug: slug.trim().toLowerCase() }) }, select: { id: true, slug: true, name: true }, orderBy: { name: 'asc' } });
    const out: { school: (typeof schools)[number]; user: NonNullable<T> }[] = [];
    for (let i = 0; i < schools.length; i += 8) {
      const batch = await Promise.all(schools.slice(i, i + 8).map(async (school) => ({ school, user: await find(this.prisma.forSchool(school.id)) })));
      for (const b of batch) if (b.user && (!Array.isArray(b.user) || b.user.length)) out.push({ school: b.school, user: b.user as NonNullable<T> });
    }
    return out;
  }

  /** One match: a one-time link into it. Several: the list to choose from. */
  private async signInOutcome(candidates: SignInCandidate[], purpose: 'login' | 'google', remember = false): Promise<SignInOutcome> {
    if (candidates.length > 1) {
      return { choose: candidates.map((c) => (c.kind === 'platform' ? { school: 'console', name: 'Owner console (Skool EdTech)' } : { school: c.school.slug, name: c.school.name })) };
    }
    const c = candidates[0]!;
    if (c.kind === 'platform') {
      const ticket = await this.tickets.create({ schoolId: '', userId: c.adminId, purpose: 'platform', remember });
      return { continueUrl: this.urls.platform(`/welcome?ticket=${ticket}`) };
    }
    const ticket = await this.tickets.create({ schoolId: c.school.id, userId: c.userId, purpose, remember });
    return { continueUrl: this.urls.school(c.school.slug, `/welcome?ticket=${ticket}`) };
  }

  /** Exchanges a one-time ticket (sign-up hand-over) for a session on the school's own host. */
  async exchangeTicket(tenant: TenantContext, token: string, ctx: LoginContext = {}): Promise<IssuedTokens & { remember?: boolean }> {
    const ticket = await this.tickets.consume(token);
    if (ticket.purpose === 'platform') {
      if (tenant.kind !== 'platform') throw new BadRequestException('This sign-in link belongs to the owner console');
      const admin = await this.prisma.platformAdmin.findUnique({ where: { id: ticket.userId } });
      if (!admin?.isActive) throw new UnauthorizedException('This account cannot sign in');
      await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
      await this.events.record({ ...ctx, platformAdminId: admin.id, identifier: admin.email, name: `${admin.name} (${admin.label ?? 'Owner'})`, roles: ['platform_owner'], success: true });
      return { ...(await this.issue({ scope: 'platform', sub: admin.id })), remember: ticket.remember };
    }
    if (tenant.kind !== 'school' || tenant.schoolId !== ticket.schoolId) throw new BadRequestException('This sign-in link belongs to another school');
    const user = await this.prisma.forSchool(ticket.schoolId).user.findUnique({ where: { id: ticket.userId }, select: { status: true, mustChangePassword: true, loginId: true, email: true, firstName: true, lastName: true } });
    if (!user || user.status !== 'active') throw new UnauthorizedException('This account cannot sign in');
    await this.prisma.forSchool(ticket.schoolId).user.update({ where: { id: ticket.userId }, data: { lastLoginAt: new Date() } });
    if (ticket.purpose === 'support' && ticket.platformAdminId) {
      // Owner support session: a normal session (it lasts until the owner signs out), marked as support
      // so every change is audited under the owner's name.
      const admin = await this.prisma.platformAdmin.findUnique({ where: { id: ticket.platformAdminId }, select: { name: true, email: true, isActive: true, label: true } });
      if (!admin?.isActive) throw new UnauthorizedException('This support link is no longer valid');
      await this.events.record({ ...ctx, schoolId: ticket.schoolId, userId: ticket.userId, platformAdminId: ticket.platformAdminId, loginId: user.loginId, identifier: admin.email, name: `Platform support · ${admin.name} (${admin.label ?? 'Owner'})`, roles: ['school_admin'], method: 'support', success: true });
      return this.issue({ scope: 'school', sub: ticket.userId, sid: ticket.schoolId, sup: ticket.platformAdminId, supn: `${admin.name} (${admin.label ?? 'Owner'})` });
    }
    const method = ticket.purpose === 'google' ? 'google' : ticket.purpose === 'login' ? 'password' : 'ticket';
    await this.events.record({ ...ctx, schoolId: ticket.schoolId, userId: ticket.userId, loginId: user.loginId, identifier: user.email ?? user.loginId, name: `${user.firstName} ${user.lastName}`, method, success: true });
    return { ...(await this.issue({ scope: 'school', sub: ticket.userId, sid: ticket.schoolId }, user.mustChangePassword)), remember: ticket.remember };
  }

  /** Rotates the refresh token. The account must still be active and on this tenant. */
  async refresh(tenant: TenantContext, refreshToken: string): Promise<IssuedTokens> {
    const { subject, token } = await this.refreshTokens.rotate(refreshToken);

    const schoolUser =
      subject.scope === 'school' && tenant.kind === 'school' && subject.sid === tenant.schoolId ? await this.schoolUser(subject.sid, subject.sub) : null;
    const valid =
      subject.scope === 'platform'
        ? tenant.kind === 'platform' && (await this.isActivePlatformAdmin(subject.sub))
        : schoolUser?.status === 'active' && (!subject.sup || (await this.isActivePlatformAdmin(subject.sup)));

    if (!valid) {
      await this.refreshTokens.revoke(token);
      throw new UnauthorizedException('Session expired');
    }
    return { ...this.signAccess(subject, schoolUser?.mustChangePassword), refreshToken: token };
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revoke(refreshToken);
  }

  async me(auth: AuthContext, tenant: TenantContext) {
    if (auth.scope === 'platform') {
      const admin = await this.prisma.platformAdmin.findUniqueOrThrow({
        where: { id: auth.adminId },
        select: { id: true, email: true, name: true, isPrimary: true, label: true },
      });
      return { scope: 'platform' as const, admin };
    }

    const user = await this.prisma.forSchool(auth.schoolId).user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: {
        id: true, loginId: true, email: true, emailVerifiedAt: true, firstName: true, lastName: true, phone: true, mustChangePassword: true, photoKey: true,
        employee: { select: { photoKey: true } }, student: { select: { photoKey: true } }, guardian: { select: { photoKey: true } },
      },
    });
    const access = await this.permissions.loadUserAccess(auth.schoolId, auth.userId);
    const school = tenant.kind === 'school' ? { id: tenant.schoolId, name: tenant.name, slug: tenant.slug } : null;
    const { emailVerifiedAt, photoKey, employee, student, guardian, ...rest } = user;
    // Their picture: the staff / student / parent record's, else the login's own.
    const photo = employee?.photoKey ?? student?.photoKey ?? guardian?.photoKey ?? photoKey ?? null;
    /** Students and staff ask the admin to change a picture they already have. */
    const photoNeedsApproval = !!(employee?.photoKey ?? student?.photoKey) && !access.roles.some((r) => r.key === 'school_admin' || r.key === 'principal');
    return { scope: 'school' as const, user: { ...rest, photoKey: photo, photoNeedsApproval, emailVerified: !!emailVerifiedAt || this.emailCheckOff }, school, ...access, support: auth.support ? { name: auth.support.name } : null };
  }

  /**
   * The signed-in school user replaces their password. Every other session of theirs ends; this one
   * continues with fresh tokens (and without the "must change" flag).
   */
  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<IssuedTokens> {
    if (auth.scope !== 'school') throw new UnauthorizedException();
    const db = this.prisma.forSchool(auth.schoolId);
    const user = await db.user.findUnique({ where: { id: auth.userId }, select: { passwordHash: true, status: true, firstName: true, loginId: true, email: true, emailVerifiedAt: true } });
    if (!user || user.status !== 'active' || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException('Your current password is not correct');
    }
    if (currentPassword === newPassword) throw new BadRequestException('Choose a password different from the current one');
    await db.user.update({ where: { id: auth.userId }, data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false } });
    const subject: TokenSubject = { scope: 'school', sub: auth.userId, sid: auth.schoolId };
    await this.refreshTokens.revokeAllFor(subject);
    if (user.email && user.emailVerifiedAt) {
      await this.delivery.trySend({ channel: 'email', to: user.email, template: 'password_changed', schoolId: auth.schoolId, data: { name: user.firstName, loginId: user.loginId, byAdmin: false } });
    }
    return this.issue(subject);
  }

  // --- Forgotten password / User ID ----------------------------------------------------------

  /**
   * Emails a reset link to the account's email (verified, or any email while EMAIL_VERIFICATION=off).
   * Always answers the same way, so it cannot be used to find out which User IDs or emails exist.
   * The owner console lists every request with its outcome; when no link could be sent, the school's
   * admins are told in-app so they can reset the password (which emails the new details).
   */
  async forgotPassword(tenant: TenantContext, identifier: string): Promise<void> {
    const typed = identifier.trim();
    try {
      if (tenant.kind === 'platform') {
        const admin = await this.prisma.platformAdmin.findUnique({ where: { email: typed.toLowerCase() } });
        if (!admin?.isActive) return void (await this.alerts.raise({ kind: 'password_reset_request', title: 'Console password reset: no such owner', body: `Someone asked to reset the owner password of "${typed}", which is not an active owner account. Nothing was sent.`, actor: typed }));
        const token = await this.resets.create({ scope: 'platform', adminId: admin.id });
        await this.delivery.send({ channel: 'email', to: admin.email, template: 'password_reset', data: { name: admin.name, url: this.urls.platform(`/reset-password?token=${token}`), minutes: RESET_TTL_MINUTES } });
        await this.alerts.raise({ kind: 'password_reset_request', title: `Console password reset: ${admin.name}`, body: `A reset link was emailed to ${admin.email}.`, actor: admin.email });
        return;
      }
      const db = this.prisma.forSchool(tenant.schoolId);
      const user = await db.user.findFirst({
        where: typed.includes('@') ? { email: typed.toLowerCase() } : { loginId: normaliseLoginId(typed) },
        select: { id: true, status: true, email: true, emailVerifiedAt: true, firstName: true, lastName: true, loginId: true },
      });
      const who = user ? `${user.firstName} ${user.lastName} (${user.loginId})` : `"${typed}"`;
      const alert = (body: string) =>
        this.alerts.raise({ kind: 'password_reset_request', title: `Password reset request · ${tenant.name}`, body: `${who}: ${body}`, link: `/schools/${tenant.schoolId}`, schoolId: tenant.schoolId, actor: typed });
      if (!user) return void (await alert('no account with this email or User ID. Nothing was sent.'));
      if (user.status !== 'active') return void (await alert('this login is disabled. Nothing was sent.'));
      if (!user.email || (!user.emailVerifiedAt && !this.emailCheckOff)) {
        await alert(`${user.email ? 'their email is not confirmed' : 'no email on file'}, so no link could be sent. The school admin was asked to reset it.`);
        await this.notifyAdminsOfRequest(tenant.schoolId, user.id, 'Password reset requested', `${who} forgot their password and has ${user.email ? 'no confirmed email' : 'no email'}. Reset it from Users: the new sign-in details are emailed to them${user.email ? '' : ' once they have an email (or hand them over yourself)'}.`);
        return;
      }
      const token = await this.resets.create({ scope: 'school', schoolId: tenant.schoolId, userId: user.id });
      await this.delivery.send({
        channel: 'email',
        to: user.email,
        template: 'password_reset',
        schoolId: tenant.schoolId,
        data: { name: user.firstName, loginId: user.loginId, schoolName: tenant.name, url: this.urls.school(tenant.slug, `/reset-password?token=${token}`), minutes: RESET_TTL_MINUTES },
      });
      await alert(`a reset link was emailed to ${user.email}.`);
    } catch (e) {
      // Same answer either way; the failure is only logged.
      this.log.error(`forgot-password failed: ${(e as Error).message}`);
    }
  }

  /** In-app (and email) notice to the school's admins about an account request they should handle. */
  private async notifyAdminsOfRequest(schoolId: string, userId: string, title: string, body: string) {
    const admins = await this.prisma.forSchool(schoolId).user.findMany({
      where: { status: 'active', id: { not: userId }, NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: 'school_admin' } } } },
      select: { id: true },
    });
    await this.notifications.notify(schoolId, admins.map((a) => a.id), { eventType: 'account_request', title, body, link: '/users' });
  }

  async checkResetToken(token: string) {
    return { valid: await this.resets.peek(token) };
  }

  /** Sets a new password from a reset link. All sessions of the account end. */
  async resetPassword(tenant: TenantContext, token: string, newPassword: string): Promise<void> {
    const subject = await this.resets.consume(token);
    const hash = await this.passwords.hash(newPassword);
    if (subject.scope === 'platform') {
      if (tenant.kind !== 'platform') throw new BadRequestException('This reset link belongs to another site');
      const admin = await this.prisma.platformAdmin.update({ where: { id: subject.adminId }, data: { passwordHash: hash } });
      await this.refreshTokens.revokeAllFor({ scope: 'platform', sub: admin.id });
      await this.delivery.trySend({ channel: 'email', to: admin.email, template: 'password_changed', data: { name: admin.name, byAdmin: false } });
      await this.alerts.raise({ kind: 'password_reset_done', title: `Console password changed: ${admin.name}`, body: `${admin.email} set a new password from a reset link.`, actor: admin.email });
      return;
    }
    if (tenant.kind !== 'school' || tenant.schoolId !== subject.schoolId) throw new BadRequestException('This reset link belongs to another school');
    const db = this.prisma.forSchool(subject.schoolId);
    const user = await db.user.update({ where: { id: subject.userId }, data: { passwordHash: hash, mustChangePassword: false }, select: { email: true, firstName: true, loginId: true } });
    await this.refreshTokens.revokeAllFor({ scope: 'school', sub: subject.userId, sid: subject.schoolId });
    if (user.email) await this.delivery.trySend({ channel: 'email', to: user.email, template: 'password_changed', schoolId: subject.schoolId, data: { name: user.firstName, loginId: user.loginId, byAdmin: false, schoolName: tenant.name } });
    await this.alerts.raise({ kind: 'password_reset_done', title: `Password changed · ${tenant.name}`, body: `${user.firstName} (${user.loginId}) set a new password from a reset link.`, link: `/schools/${subject.schoolId}`, schoolId: subject.schoolId, actor: user.email ?? user.loginId });
  }

  /** Emails every User ID of this school whose verified email matches. Same answer either way. */
  async forgotUserId(tenant: TenantContext, email: string): Promise<void> {
    if (tenant.kind !== 'school') throw new BadRequestException('User IDs belong to a school site');
    try {
      const users = await this.prisma.forSchool(tenant.schoolId).user.findMany({
        where: { email, ...(!this.emailCheckOff && { emailVerifiedAt: { not: null } }), status: 'active' },
        select: { loginId: true, firstName: true, lastName: true, userRoles: { select: { role: { select: { key: true } } } } },
        orderBy: { loginId: 'asc' },
      });
      await this.alerts.raise({
        kind: 'user_id_request',
        title: `User ID request · ${tenant.name}`,
        body: users.length ? `${email} asked for their User ID; ${users.length} account(s) emailed: ${users.map((u) => u.loginId).join(', ')}.` : `${email} asked for their User ID, but no account here has this ${this.emailCheckOff ? '' : 'confirmed '}email. Nothing was sent.`,
        link: `/schools/${tenant.schoolId}`,
        schoolId: tenant.schoolId,
        actor: email,
      });
      if (!users.length) return;
      await this.delivery.send({
        channel: 'email',
        to: email,
        template: 'user_ids',
        schoolId: tenant.schoolId,
        data: {
          schoolName: tenant.name,
          signInUrl: this.urls.school(tenant.slug, '/login'),
          accounts: users.map((u) => ({ loginId: u.loginId, name: `${u.firstName} ${u.lastName}`, role: u.userRoles.map((r) => ROLE_LABEL[r.role.key] ?? r.role.key).join(', ') })),
        },
      });
    } catch (e) {
      this.log.error(`forgot-user-id failed: ${(e as Error).message}`);
    }
  }

  // --- Email verification (OTP) for the signed-in user ----------------------------------------

  /** Sends a code to the account's email, or to a new address the person wants to use. */
  async sendEmailCode(auth: AuthContext, tenant: TenantContext, email?: string) {
    if (auth.scope !== 'school' || tenant.kind !== 'school') throw new BadRequestException('Only school accounts verify an email here');
    const user = await this.prisma.forSchool(auth.schoolId).user.findUniqueOrThrow({ where: { id: auth.userId }, select: { email: true } });
    const target = email ?? user.email;
    if (!target) throw new BadRequestException('Enter your email address');
    return this.codes.send({ owner: `user:${auth.schoolId}:${auth.userId}`, email: target, purpose: target === user.email ? 'verify' : 'change', schoolId: auth.schoolId, schoolName: tenant.name });
  }

  /** Confirms the code: the address becomes the account's verified email. */
  async verifyEmailCode(auth: AuthContext, verificationId: string, code: string) {
    if (auth.scope !== 'school') throw new BadRequestException('Only school accounts verify an email here');
    const email = await this.codes.verify(verificationId, `user:${auth.schoolId}:${auth.userId}`, code);
    await this.prisma.forSchool(auth.schoolId).user.update({ where: { id: auth.userId }, data: { email, emailVerifiedAt: new Date() } });
    return { email, emailVerified: true };
  }

  /** Ends all sessions of an owner account (after the main owner disables it). */
  endPlatformSessions(adminId: string): Promise<void> {
    return this.refreshTokens.revokeAllFor({ scope: 'platform', sub: adminId });
  }

  /** Ends all sessions of a school user (after an administrator resets or disables the login). */
  endSessions(schoolId: string, userId: string): Promise<void> {
    return this.refreshTokens.revokeAllFor({ scope: 'school', sub: userId, sid: schoolId });
  }

  get refreshMaxAgeSeconds(): number {
    return this.refreshTokens.maxAgeSeconds;
  }

  private async issue(subject: TokenSubject, mustChangePassword = false): Promise<IssuedTokens> {
    const refreshToken = await this.refreshTokens.issue(subject);
    return { ...this.signAccess(subject, mustChangePassword), refreshToken };
  }

  private signAccess(subject: TokenSubject, mustChangePassword = false): { accessToken: string; expiresIn: number } {
    const payload: AccessTokenPayload =
      subject.scope === 'platform'
        ? { sub: subject.sub, scope: 'platform' }
        : { sub: subject.sub, scope: 'school', sid: subject.sid, ...(mustChangePassword && { pwc: true as const }), ...(subject.sup && { sup: subject.sup, supn: subject.supn }) };
    return { accessToken: this.jwt.sign(payload), expiresIn: this.accessTtl };
  }

  private async isActivePlatformAdmin(id: string): Promise<boolean> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id }, select: { isActive: true } });
    return admin?.isActive === true;
  }

  private schoolUser(schoolId: string, id: string) {
    return this.prisma.forSchool(schoolId).user.findUnique({ where: { id }, select: { status: true, mustChangePassword: true } });
  }
}
