import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService, type TokenSubject } from './refresh-token.service.js';

export type AccessTokenPayload =
  | { sub: string; scope: 'platform' }
  /** `pwc`: the password was set by an administrator and must be replaced before anything else. */
  | { sub: string; scope: 'school'; sid: string; pwc?: true };

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly accessTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly permissions: PermissionService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  /** Login is tenant-aware: the host decides whether this is a school user or a platform admin. */
  async login(tenant: TenantContext, email: string, password: string): Promise<IssuedTokens> {
    if (tenant.kind === 'platform') {
      const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
      const ok = await this.passwords.verify(admin?.passwordHash, password);
      if (!admin || !ok || !admin.isActive) throw new UnauthorizedException(INVALID_CREDENTIALS);
      await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
      return this.issue({ scope: 'platform', sub: admin.id });
    }

    const db = this.prisma.forSchool(tenant.schoolId);
    const user = await db.user.findUnique({
      where: { schoolId_email: { schoolId: tenant.schoolId, email } },
    });
    const ok = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !ok || user.status !== 'active') throw new UnauthorizedException(INVALID_CREDENTIALS);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issue({ scope: 'school', sub: user.id, sid: tenant.schoolId }, user.mustChangePassword);
  }

  /** Rotates the refresh token. The account must still be active and on this tenant. */
  async refresh(tenant: TenantContext, refreshToken: string): Promise<IssuedTokens> {
    const { subject, token } = await this.refreshTokens.rotate(refreshToken);

    const schoolUser =
      subject.scope === 'school' && tenant.kind === 'school' && subject.sid === tenant.schoolId ? await this.schoolUser(subject.sid, subject.sub) : null;
    const valid =
      subject.scope === 'platform'
        ? tenant.kind === 'platform' && (await this.isActivePlatformAdmin(subject.sub))
        : schoolUser?.status === 'active';

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
        select: { id: true, email: true, name: true },
      });
      return { scope: 'platform' as const, admin };
    }

    const user = await this.prisma.forSchool(auth.schoolId).user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, mustChangePassword: true },
    });
    const access = await this.permissions.loadUserAccess(auth.schoolId, auth.userId);
    const school = tenant.kind === 'school' ? { id: tenant.schoolId, name: tenant.name, slug: tenant.slug } : null;
    return { scope: 'school' as const, user, school, ...access };
  }

  /**
   * The signed-in school user replaces their password. Every other session of theirs ends; this one
   * continues with fresh tokens (and without the "must change" flag).
   */
  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<IssuedTokens> {
    if (auth.scope !== 'school') throw new UnauthorizedException();
    const db = this.prisma.forSchool(auth.schoolId);
    const user = await db.user.findUnique({ where: { id: auth.userId }, select: { passwordHash: true, status: true } });
    if (!user || user.status !== 'active' || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException('Your current password is not correct');
    }
    if (currentPassword === newPassword) throw new BadRequestException('Choose a password different from the current one');
    await db.user.update({ where: { id: auth.userId }, data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false } });
    const subject: TokenSubject = { scope: 'school', sub: auth.userId, sid: auth.schoolId };
    await this.refreshTokens.revokeAllFor(subject);
    return this.issue(subject);
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
        : { sub: subject.sub, scope: 'school', sid: subject.sid, ...(mustChangePassword && { pwc: true as const }) };
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
