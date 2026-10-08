import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ApplyLeaveDto,
  CheckInDto,
  DecideLeaveDto,
  GeofenceDto,
  LeaveListQuery,
  LeaveTypeDto,
  MarkAttendanceDto,
  MonthQuery,
  ReviewDto,
  SectionDayQuery,
  StaffAttendanceQuery,
  WeeklyOffDaysDto,
} from './attendance.dto.js';
import { LeaveService } from './leave.service.js';
import { StaffAttendanceService } from './staff-attendance.service.js';
import { StudentAttendanceService } from './student-attendance.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();

/** Student attendance per class session (Attendance row: Admin CRUD, Accounts View, Teacher Mark, Student Own, Parent Children). */
@Controller('attendance')
export class StudentAttendanceController {
  constructor(private readonly attendance: StudentAttendanceService) {}

  @RequireAccess('attendance', ['crud', 'view', 'mark']) @Get('sessions/:id')
  roster(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.attendance.roster(a, id);
  }

  @RequireAccess('attendance', ['crud', 'mark']) @Post('sessions/:id') @HttpCode(HttpStatus.OK)
  mark(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: MarkAttendanceDto) {
    return this.attendance.mark(a, id, dto);
  }

  @RequireAccess('attendance', ['crud', 'view', 'mark', 'own', 'children']) @Get('students/:id/summary')
  studentSummary(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.attendance.studentSummary(a, id);
  }

  @RequireAccess('attendance', ['crud', 'view']) @Get('sections/day')
  sectionDay(@CurrentAuth() a: SchoolAuth, @Query() q: SectionDayQuery) {
    return this.attendance.sectionDay(a.schoolId, q.sectionId, q.date);
  }
}

/** Staff check-in with GPS geofencing, and admin review. */
@Controller('staff-attendance')
export class StaffAttendanceController {
  constructor(private readonly staff: StaffAttendanceService) {}

  @RequireAccess('attendance', ['own', 'mark', 'crud']) @Post('check-in')
  checkIn(@CurrentAuth() a: SchoolAuth, @Body() dto: CheckInDto) {
    return this.staff.checkIn(a.schoolId, a.userId, dto);
  }

  @RequireAccess('attendance', ['own', 'mark', 'crud']) @Post('check-out') @HttpCode(HttpStatus.OK)
  checkOut(@CurrentAuth() a: SchoolAuth) {
    return this.staff.checkOut(a.schoolId, a.userId);
  }

  @RequireAccess('attendance', ['own', 'mark', 'crud']) @Get('me')
  mine(@CurrentAuth() a: SchoolAuth, @Query() q: MonthQuery) {
    return this.staff.mine(a.schoolId, a.userId, q.month);
  }

  @RequireAccess('attendance', ['crud', 'view']) @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: StaffAttendanceQuery) {
    return this.staff.list(a.schoolId, q);
  }

  @RequireAccess('attendance', ['crud']) @Post(':id/review') @HttpCode(HttpStatus.OK)
  review(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ReviewDto) {
    return this.staff.review(a.schoolId, id, dto, a.userId);
  }

  @RequireAccess('attendance', ['crud', 'view']) @Get('geofences')
  geofences(@CurrentAuth() a: SchoolAuth) {
    return this.staff.listGeofences(a.schoolId);
  }

  @RequireAccess('attendance', ['crud']) @Put('geofences/:campusId')
  setGeofence(@CurrentAuth() a: SchoolAuth, @Param('campusId', Id()) campusId: string, @Body() dto: GeofenceDto) {
    return this.staff.setGeofence(a.schoolId, campusId, dto, a.userId);
  }
}

/** Leave (approved rows: Admin Approve, Accounts View, Teacher/Non-teaching Own). */
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly prisma: PrismaService,
  ) {}

  @RequireAccess('leave', ['approve', 'view', 'own']) @Get('types')
  types(@CurrentAuth() a: SchoolAuth) {
    return this.leave.listTypes(a.schoolId);
  }

  @RequireAccess('leave', ['approve']) @Post('types')
  createType(@CurrentAuth() a: SchoolAuth, @Body() dto: LeaveTypeDto) {
    return this.leave.createType(a.schoolId, dto);
  }

  @RequireAccess('leave', ['approve']) @Patch('types/:id')
  updateType(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: LeaveTypeDto) {
    return this.leave.updateType(a.schoolId, id, dto);
  }

  @RequireAccess('leave', ['own']) @Get('me')
  mine(@CurrentAuth() a: SchoolAuth) {
    return this.leave.mine(a.schoolId, a.userId);
  }

  @RequireAccess('leave', ['own']) @Post()
  apply(@CurrentAuth() a: SchoolAuth, @Body() dto: ApplyLeaveDto) {
    return this.leave.apply(a.schoolId, a.userId, dto);
  }

  @RequireAccess('leave', ['own']) @Post(':id/cancel') @HttpCode(HttpStatus.OK)
  cancel(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.leave.cancel(a.schoolId, a.userId, id);
  }

  @RequireAccess('leave', ['approve', 'view']) @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: LeaveListQuery) {
    return this.leave.list(a.schoolId, q);
  }

  @RequireAccess('leave', ['approve']) @Post(':id/decision') @HttpCode(HttpStatus.OK)
  decide(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: DecideLeaveDto) {
    return this.leave.decide(a.schoolId, id, dto, a.userId);
  }

  /** School working week, used to count leave days. */
  @RequireAccess('settings', ['crud']) @Put('weekly-off-days')
  async setWeeklyOff(@CurrentAuth() a: SchoolAuth, @Body() dto: WeeklyOffDaysDto) {
    const days = [...new Set(dto.weeklyOffDays)].sort();
    return this.prisma.forSchool(a.schoolId).schoolSettings.update({ where: { schoolId: a.schoolId }, data: { weeklyOffDays: days }, select: { weeklyOffDays: true } });
  }

  @RequireAccess('leave', ['approve', 'view', 'own']) @Get('weekly-off-days')
  async weeklyOff(@CurrentAuth() a: SchoolAuth) {
    return this.prisma.forSchool(a.schoolId).schoolSettings.findUnique({ where: { schoolId: a.schoolId }, select: { weeklyOffDays: true } });
  }
}
