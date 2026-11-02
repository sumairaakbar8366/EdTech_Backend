import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { InsightsService } from './insights.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;

@Controller('reports')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Monthly / yearly growth report; `ref` is any date inside the period (default today). */
  @RequireAccess('reports', ['all']) @Get('performance')
  performance(@CurrentAuth() a: SchoolAuth, @Query('period') period = 'month', @Query('ref') ref?: string) {
    if (period !== 'month' && period !== 'year') throw new BadRequestException('period must be "month" or "year"');
    const date = ref ? new Date(`${ref.slice(0, 10)}T12:00:00Z`) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequestException('ref must be a date like 2026-10-28');
    return this.insights.performance(a.schoolId, period, date);
  }
}
