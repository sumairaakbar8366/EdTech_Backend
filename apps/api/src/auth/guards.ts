import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { hasAccess } from '@schoolerp/shared';
import type { AppRequest } from '../common/request-context.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import {
  ALLOW_PENDING_PASSWORD,
  IS_PUBLIC,
  REQUIRED_ACCESS,
  REQUIRED_SCOPE,
  type RequiredAccess,
} from './decorators.js';
import type { AccessTokenPayload } from './auth.service.js';

/**
 * Global guard #1: authenticates every non-public route.
 * The access token must belong to the tenant the request was made to: a school
 * token only works on that school's host, a platform token only on the platform host.
 */
/** A verified login is remembered briefly so not every request reads the database. */
export const emailOkKey = (schoolId: string, userId: string) => `schoolerp:email-ok:${schoolId}:${userId}`;

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly emailCheckOff: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.emailCheckOff = config.get('EMAIL_VERIFICATION', { infer: true }) === 'off';
  }

  /**
   * No access until the person has confirmed their own email with the emailed code (OTP). Only
   * signing-in steps work before that (change password, send / check the code, who am I). Students
   * without an email of their own (they sign in with their User ID) and owner support sessions are
   * exempt.
   */
  private async assertEmailVerified(schoolId: string, userId: string) {
    if (this.emailCheckOff) return;
    const key = emailOkKey(schoolId, userId);
    if (await this.redis.get(key)) return;
    const user = await this.prisma.forSchool(schoolId).user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, userRoles: { select: { role: { select: { key: true } } } } },
    });
    if (!user) throw new UnauthorizedException();
    const studentWithoutEmail = !user.email && user.userRoles.length > 0 && user.userRoles.every((r) => r.role.key === 'student');
    if (!user.emailVerifiedAt && !studentWithoutEmail) throw new ForbiddenException('Please verify your email with the code we sent before using your account');
    await this.redis.set(key, '1', 'EX', 600);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }

    const tenant = req.tenant;
    if (tenant?.kind === 'platform' && payload.scope === 'platform') {
      req.auth = { scope: 'platform', adminId: payload.sub };
      return true;
    }
    if (tenant?.kind === 'school' && payload.scope === 'school' && payload.sid === tenant.schoolId) {
      if (payload.pwc && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, [context.getHandler(), context.getClass()])) {
        throw new ForbiddenException('Please change your password to continue');
      }
      const setupStep = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, [context.getHandler(), context.getClass()]);
      if (!payload.sup && !setupStep) await this.assertEmailVerified(tenant.schoolId, payload.sub);
      req.auth = { scope: 'school', userId: payload.sub, schoolId: tenant.schoolId, ...(payload.sup && { support: { adminId: payload.sup, name: payload.supn ?? 'Platform owner' } }) };
      return true;
    }
    throw new UnauthorizedException();
  }
}

/** Global guard #2: enforces @PlatformOnly and @RequireAccess (page-15 matrix). */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const scope = this.reflector.getAllAndOverride<'platform' | undefined>(REQUIRED_SCOPE, targets);
    const access = this.reflector.getAllAndOverride<RequiredAccess | undefined>(REQUIRED_ACCESS, targets);
    if (!scope && !access) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException();

    if (scope === 'platform' && auth.scope !== 'platform') throw new ForbiddenException();

    if (access) {
      if (auth.scope !== 'school') throw new ForbiddenException();
      if (!req.permissionKeys) {
        const { permissions } = await this.permissions.loadUserAccess(auth.schoolId, auth.userId);
        req.permissionKeys = new Set(permissions);
      }
      if (!hasAccess(req.permissionKeys, access.module, access.levels)) {
        throw new ForbiddenException('You do not have permission for this action');
      }
    }
    return true;
  }
}
