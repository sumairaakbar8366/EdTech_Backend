import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AppRequest, TenantContext } from '../common/request-context.js';
import type { PermissionService } from '../rbac/permission.service.js';
import { IS_PUBLIC, REQUIRED_ACCESS, REQUIRED_SCOPE } from './decorators.js';
import { AccessGuard, AuthGuard } from './guards.js';

const SCHOOL_A = '0192f0a0-0000-7000-8000-00000000000a';
const SCHOOL_B = '0192f0a0-0000-7000-8000-00000000000b';
const jwt = new JwtService({ secret: 'test-secret-test-secret-test-secret!!' });

function context(req: Partial<AppRequest>, metadata: Record<string, unknown> = {}) {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(metadata)) Reflect.defineMetadata(key, value, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function request(tenant: TenantContext, token?: string): Partial<AppRequest> {
  return { tenant, headers: token ? { authorization: `Bearer ${token}` } : {} } as Partial<AppRequest>;
}

const schoolA: TenantContext = { kind: 'school', schoolId: SCHOOL_A, slug: 'alpha', name: 'Alpha' };

describe('AuthGuard', () => {
  const guard = new AuthGuard(new Reflector(), jwt);

  it('lets public routes through without a token', async () => {
    await expect(guard.canActivate(context(request(schoolA), { [IS_PUBLIC]: true }))).resolves.toBe(true);
  });

  it('rejects missing and invalid tokens', async () => {
    await expect(guard.canActivate(context(request(schoolA)))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(context(request(schoolA, 'not-a-jwt')))).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a school token on its own school host', async () => {
    const req = request(schoolA, jwt.sign({ sub: 'u1', scope: 'school', sid: SCHOOL_A }));
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.auth).toEqual({ scope: 'school', userId: 'u1', schoolId: SCHOOL_A });
  });

  it("rejects a school token on another school's host", async () => {
    const req = request(schoolA, jwt.sign({ sub: 'u1', scope: 'school', sid: SCHOOL_B }));
    await expect(guard.canActivate(context(req))).rejects.toThrow(UnauthorizedException);
  });

  it('keeps platform and school tokens on their own hosts', async () => {
    const platformToken = jwt.sign({ sub: 'p1', scope: 'platform' });
    const schoolToken = jwt.sign({ sub: 'u1', scope: 'school', sid: SCHOOL_A });
    await expect(guard.canActivate(context(request(schoolA, platformToken)))).rejects.toThrow(UnauthorizedException);
    await expect(
      guard.canActivate(context(request({ kind: 'platform' }, schoolToken))),
    ).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(context(request({ kind: 'platform' }, platformToken)))).resolves.toBe(true);
  });
});

describe('AccessGuard', () => {
  const permissions = {
    loadUserAccess: vi.fn(async () => ({ roles: [], permissions: ['settings:crud', 'students:view'] })),
  } as unknown as PermissionService;
  const guard = new AccessGuard(new Reflector(), permissions);
  const schoolAuth = { scope: 'school' as const, userId: 'u1', schoolId: SCHOOL_A };

  it('allows routes without requirements', async () => {
    await expect(guard.canActivate(context({ auth: schoolAuth }))).resolves.toBe(true);
  });

  it('enforces the permission matrix', async () => {
    const ok = context({ auth: schoolAuth }, { [REQUIRED_ACCESS]: { module: 'settings', levels: ['crud'] } });
    await expect(guard.canActivate(ok)).resolves.toBe(true);

    const denied = context({ auth: schoolAuth }, { [REQUIRED_ACCESS]: { module: 'students', levels: ['crud'] } });
    await expect(guard.canActivate(denied)).rejects.toThrow(ForbiddenException);
  });

  it('keeps platform admins out of school-permission routes and vice versa', async () => {
    const platformAuth = { scope: 'platform' as const, adminId: 'p1' };
    await expect(
      guard.canActivate(context({ auth: platformAuth }, { [REQUIRED_ACCESS]: { module: 'settings', levels: ['crud'] } })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(context({ auth: schoolAuth }, { [REQUIRED_SCOPE]: 'platform' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(context({ auth: platformAuth }, { [REQUIRED_SCOPE]: 'platform' })),
    ).resolves.toBe(true);
  });
});
