import { Body, Controller, DefaultValuePipe, Delete, ForbiddenException, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CurrentAuth, PlatformOnly, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService, type ActivityItem } from './activity.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
type PlatformAuth = Extract<AuthContext, { scope: 'platform' }>;
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

class ActivityQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) page = 1;
  @IsOptional() @Type(() => Number) @IsIn([1, 7, 30, 90]) days = 30;
  @IsOptional() @IsIn(['critical', 'warning', 'info']) level?: 'critical' | 'warning' | 'info';
  @IsOptional() @IsIn(['signin', 'change']) kind?: 'signin' | 'change';
  @IsOptional() @IsUUID() campusId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

class PlatformActivityQueryDto extends ActivityQueryDto {
  @IsUUID() schoolId!: string;
}

class TeamActivityQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) page = 1;
  @IsOptional() @Type(() => Number) @IsIn([1, 7, 30, 90]) days = 30;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

class EditLogDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

class SchoolOnlyDto {
  @IsOptional() @IsUUID() schoolId?: string;
}

const KINDS = ['signin', 'change', 'platform'] as const;
function kindOf(v: string): ActivityItem['kind'] {
  if (!(KINDS as readonly string[]).includes(v)) throw new ForbiddenException('Unknown log kind');
  return v as ActivityItem['kind'];
}

/** Activity monitor for the school's administrators / principal: sign-ins and sensitive changes. */
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @RequireAccess('audit', ['view']) @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ActivityQueryDto) {
    return this.activity.list(a.schoolId, q);
  }

  /** School Admins only (settings: crud): not the principal, not shared admins. */
  @RequireAccess('settings', ['crud']) @Patch(':kind/:id')
  edit(@CurrentAuth() a: SchoolAuth, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditLogDto) {
    return this.activity.edit(a.schoolId, kindOf(kind), id, dto);
  }

  @RequireAccess('settings', ['crud']) @Delete(':kind/:id')
  remove(@CurrentAuth() a: SchoolAuth, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.activity.remove(a.schoolId, kindOf(kind), id);
  }
}

/** The same monitor for the platform owner, one school (and optionally one campus) at a time. */
@PlatformOnly()
@Controller('platform/console/activity')
export class PlatformActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query() q: PlatformActivityQueryDto) {
    return this.activity.list(q.schoolId, q);
  }

  /** The owner team's own sign-ins and console changes. */
  @Get('team')
  team(@Query() q: TeamActivityQueryDto) {
    return this.activity.listPlatform(q);
  }

  /** Main owner only. With `schoolId` the entry is a school's; without, an owner-console entry. */
  @Patch(':kind/:id')
  async edit(@CurrentAuth() a: PlatformAuth, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Query() s: SchoolOnlyDto, @Body() dto: EditLogDto) {
    await this.assertPrimary(a.adminId);
    return this.activity.edit(s.schoolId ?? null, kindOf(kind), id, dto);
  }

  @Delete(':kind/:id')
  async remove(@CurrentAuth() a: PlatformAuth, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Query() s: SchoolOnlyDto) {
    await this.assertPrimary(a.adminId);
    return this.activity.remove(s.schoolId ?? null, kindOf(kind), id);
  }

  private async assertPrimary(adminId: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { isPrimary: true } });
    if (!admin?.isPrimary) throw new ForbiddenException('Only the main owner can edit or delete logs');
  }
}
