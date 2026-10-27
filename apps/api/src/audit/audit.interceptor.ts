import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import type { AppRequest } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { apiPath } from '../tenancy/path-tenant.js';
import { isDelegateRole } from '../users/delegates.js';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Writes that are not changes worth auditing (session handling, read markers). */
const SKIP = [/^\/auth\//, /^\/notifications\//, /\/read$/];

/**
 * Page 14 audit trail: every successful write by a school user is recorded with who, what, when
 * and from where. Recording happens after the response and never fails the request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!WRITE.has(req.method) || !req.auth) return next.handle();
    const path = apiPath(req);
    if (SKIP.some((r) => r.test(path))) return next.handle();
    if (req.auth.scope === 'platform') {
      const { adminId } = req.auth;
      return next.handle().pipe(tap(() => void this.recordPlatform(adminId, req.method, path, req.ip ?? null)));
    }
    const { schoolId, userId, support } = req.auth;
    return next.handle().pipe(
      tap((body) => {
        const responseId = body && typeof body === 'object' && 'id' in body && typeof (body as { id: unknown }).id === 'string' ? (body as { id: string }).id : null;
        void this.record(schoolId, userId, req.method, path, path.match(UUID)?.[0] ?? responseId, req.ip ?? null, support ? `Platform support · ${support.name}` : null);
      }),
    );
  }

  private async record(schoolId: string, userId: string, method: string, path: string, entityId: string | null, ip: string | null, actorOverride: string | null) {
    try {
      const db = this.prisma.forSchool(schoolId);
      const user = await db.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, userRoles: { select: { role: { select: { key: true, name: true } } } } } });
      // Shared admins and the principal are named with their role, e.g. "Sara Khan (Admin 2)".
      const tag = user?.userRoles.find((r) => isDelegateRole(r.role.key) || r.role.key === 'principal')?.role.name;
      const segments = path.split('/').filter(Boolean);
      const last = segments[segments.length - 1] ?? '';
      // POST /fees/payments/:id/void → 'void'; POST /fees/payments → 'create'.
      const verb = method === 'POST' && UUID.test(path) && !UUID.test(last) ? last : null;
      const action = method === 'DELETE' ? 'delete' : method === 'POST' ? (verb ?? 'create') : 'update';
      await db.auditLog.create({
        data: { schoolId, actorId: userId, actorName: actorOverride ?? (user ? `${user.firstName} ${user.lastName}${tag ? ` (${tag})` : ''}` : null), action, entity: segments[0] ?? 'unknown', entityId, method, path, ip },
      });
    } catch (e) {
      this.log.warn(`audit write failed for ${method} ${path}: ${(e as Error).message}`);
    }
  }

  /** Owner console writes, named "Owner" or the shared owner's label ("Owner 2"). */
  private async recordPlatform(adminId: string, method: string, path: string, ip: string | null) {
    try {
      const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { name: true, label: true } });
      const segments = path.split('/').filter((s) => s && s !== 'platform' && s !== 'console');
      const last = segments[segments.length - 1] ?? '';
      const verb = method === 'POST' && UUID.test(path) && !UUID.test(last) ? last : null;
      const action = method === 'DELETE' ? 'delete' : method === 'POST' ? (verb ?? 'create') : 'update';
      await this.prisma.platformAuditLog.create({
        data: { adminId, actorName: admin ? `${admin.name} (${admin.label ?? 'Owner'})` : null, action, entity: segments[0] ?? 'unknown', method, path, ip },
      });
    } catch (e) {
      this.log.warn(`platform audit write failed for ${method} ${path}: ${(e as Error).message}`);
    }
  }
}
