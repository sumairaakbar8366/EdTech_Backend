import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { ReportsService } from './reports.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;

/** Page 15 reports row: admins see all reports, accounts the financial ones. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequireAccess('reports', ['all', 'finance']) @Get('finance')
  finance(@CurrentAuth() a: SchoolAuth) {
    return this.reports.finance(a.schoolId);
  }

  @RequireAccess('reports', ['all']) @Get('attendance')
  attendance(@CurrentAuth() a: SchoolAuth, @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.reports.attendance(a.schoolId, Math.min(365, Math.max(1, days)));
  }

  @RequireAccess('reports', ['all']) @Get('academics')
  academics(@CurrentAuth() a: SchoolAuth) {
    return this.reports.academics(a.schoolId);
  }
}
