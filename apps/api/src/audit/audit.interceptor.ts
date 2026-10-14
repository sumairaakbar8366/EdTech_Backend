import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import type { AppRequest } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { apiPath } from '../tenancy/path-tenant.js';

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
    if (!WRITE.has(req.method) || req.auth?.scope !== 'school') return next.handle();
    const path = apiPath(req);
    if (SKIP.some((r) => r.test(path))) return next.handle();
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
      const user = await db.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
      const segments = path.split('/').filter(Boolean);
      const last = segments[segments.length - 1] ?? '';
      // POST /fees/payments/:id/void → 'void'; POST /fees/payments → 'create'.
      const verb = method === 'POST' && UUID.test(path) && !UUID.test(last) ? last : null;
      const action = method === 'DELETE' ? 'delete' : method === 'POST' ? (verb ?? 'create') : 'update';
      await db.auditLog.create({
        data: { schoolId, actorId: userId, actorName: actorOverride ?? (user ? `${user.firstName} ${user.lastName}` : null), action, entity: segments[0] ?? 'unknown', entityId, method, path, ip },
      });
    } catch (e) {
      this.log.warn(`audit write failed for ${method} ${path}: ${(e as Error).message}`);
    }
  }
}
