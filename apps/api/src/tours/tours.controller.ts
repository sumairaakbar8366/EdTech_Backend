import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { CurrentAuth } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

class TourStatusDto {
  @IsIn(['done', 'skipped']) status: 'done' | 'skipped';
}

const subjectOf = (a: AuthContext) => (a.scope === 'platform' ? `p:${a.adminId}` : `u:${a.userId}`);
const KEY = /^[a-z0-9-]{1,60}$/;

/** Which guided tours this person has finished or skipped, so each one shows only once. */
@Controller('tours')
export class ToursController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async mine(@CurrentAuth() a: AuthContext) {
    const rows = await this.prisma.tourProgress.findMany({ where: { subject: subjectOf(a) }, select: { tourKey: true, status: true } });
    return { tours: Object.fromEntries(rows.map((r) => [r.tourKey, r.status])) };
  }

  @Put(':key') @HttpCode(HttpStatus.OK)
  async finish(@CurrentAuth() a: AuthContext, @Param('key') key: string, @Body() dto: TourStatusDto) {
    if (!KEY.test(key)) return { ok: false };
    const subject = subjectOf(a);
    await this.prisma.tourProgress.upsert({ where: { subject_tourKey: { subject, tourKey: key } }, create: { subject, tourKey: key, status: dto.status }, update: { status: dto.status } });
    return { ok: true };
  }

  /** "Show me the tours again". */
  @Delete() @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@CurrentAuth() a: AuthContext): Promise<void> {
    await this.prisma.tourProgress.deleteMany({ where: { subject: subjectOf(a) } });
  }
}
