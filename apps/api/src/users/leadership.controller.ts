import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { AddLeaderDto, UpdateLeaderDto } from './leadership.dto.js';
import { LeadershipService } from './leadership.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Admin = () => RequireAccess('settings', ['crud']);

/** Principal, director, vice principal… seats: school administrators only. */
@Controller('leadership')
export class LeadershipController {
  constructor(private readonly leadership: LeadershipService) {}

  @Admin() @Get()
  overview(@CurrentAuth() a: SchoolAuth) {
    return this.leadership.overview(a.schoolId);
  }

  @Admin() @Post()
  add(@CurrentAuth() a: SchoolAuth, @Body() dto: AddLeaderDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.leadership.add(a.schoolId, a.userId, dto);
  }

  @Admin() @Patch(':userId')
  update(@CurrentAuth() a: SchoolAuth, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateLeaderDto) {
    return this.leadership.update(a.schoolId, userId, dto);
  }

  @Admin() @Delete(':userId') @HttpCode(HttpStatus.OK)
  remove(@CurrentAuth() a: SchoolAuth, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.leadership.remove(a.schoolId, a.userId, userId);
  }
}
