import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessLevel, Module } from '@schoolerp/shared';
import type { AppRequest, AuthContext } from '../common/request-context.js';

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_SCOPE = 'auth:requiredScope';
export const REQUIRED_ACCESS = 'auth:requiredAccess';
export const ALLOW_PENDING_PASSWORD = 'auth:allowPendingPassword';

export interface RequiredAccess {
  module: Module;
  levels: readonly AccessLevel[];
}

/** Route needs no access token. Every other route is authenticated by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Reachable while the user still has to replace an administrator-issued password. */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

/** Route is only for platform admins on the platform host. */
export const PlatformOnly = () => SetMetadata(REQUIRED_SCOPE, 'platform');

/**
 * Route needs a school user holding at least one of `levels` on `module`
 * (page-15 permission matrix), e.g. `@RequireAccess('settings', ['crud'])`.
 */
export const RequireAccess = (module: Module, levels: readonly AccessLevel[]) =>
  SetMetadata(REQUIRED_ACCESS, { module, levels } satisfies RequiredAccess);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new Error('CurrentAuth used on an unauthenticated route');
  return req.auth;
});
