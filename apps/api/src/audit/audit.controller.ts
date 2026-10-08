import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const PAGE_SIZE = 50;

/** Audit log browser for school administrators (page 15: audit = admin view). */
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @RequireAccess('audit', ['view']) @Get()
  async list(
    @CurrentAuth() a: SchoolAuth,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('entity') entity?: string,
    @Query('q') q?: string,
  ) {
    const db = this.prisma.forSchool(a.schoolId);
    const where = {
      ...(entity ? { entity } : {}),
      ...(q ? { OR: [{ actorName: { contains: q, mode: 'insensitive' as const } }, { path: { contains: q, mode: 'insensitive' as const } }] } : {}),
    };
    const p = Math.max(1, page);
    const [items, total, entities] = await Promise.all([
      db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      db.auditLog.count({ where }),
      db.auditLog.groupBy({ by: ['entity'], _count: { _all: true }, orderBy: { entity: 'asc' } }),
    ]);
    return { items, total, page: p, pageSize: PAGE_SIZE, entities: entities.map((e) => ({ entity: e.entity, count: e._count._all })) };
  }
}
