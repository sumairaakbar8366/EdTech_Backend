import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { hasAccess } from '@schoolerp/shared';
import type { AppRequest } from '../common/request-context.js';
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
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

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
