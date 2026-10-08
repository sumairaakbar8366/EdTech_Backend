import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { MonitorQuery, SectionTimetableQuery, SlotDto, StartSessionDto, TeacherOptionsQuery, TeacherTimetableQuery } from './timetable.dto.js';
import { TimetableService } from './timetable.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();

/** Timetable (page-15 "Timetable": Admin CRUD; everyone else View). */
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @RequireAccess('timetable', ['crud', 'view']) @Get('section')
  section(@CurrentAuth() a: SchoolAuth, @Query() q: SectionTimetableQuery) {
    return this.timetable.sectionTimetable(a.schoolId, q.sectionId, q.academicYearId);
  }

  @RequireAccess('timetable', ['crud', 'view']) @Get('teacher')
  teacher(@CurrentAuth() a: SchoolAuth, @Query() q: TeacherTimetableQuery) {
    return this.timetable.teacherTimetable(a.schoolId, q.employeeId, q.academicYearId);
  }

  @RequireAccess('timetable', ['crud', 'view']) @Get('me')
  me(@CurrentAuth() a: SchoolAuth) {
    return this.timetable.myTimetable(a.schoolId, a.userId);
  }

  @RequireAccess('timetable', ['crud', 'view']) @Get('children')
  children(@CurrentAuth() a: SchoolAuth) {
    return this.timetable.childrenTimetables(a.schoolId, a.userId);
  }

  @RequireAccess('timetable', ['crud']) @Get('teacher-options')
  teacherOptions(@CurrentAuth() a: SchoolAuth, @Query() q: TeacherOptionsQuery) {
    return this.timetable.teacherOptions(a.schoolId, q);
  }

  @RequireAccess('timetable', ['crud']) @Post('slots')
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: SlotDto) {
    return this.timetable.createSlot(a.schoolId, dto);
  }

  @RequireAccess('timetable', ['crud']) @Patch('slots/:id')
  update(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: SlotDto) {
    return this.timetable.updateSlot(a.schoolId, id, dto);
  }

  @RequireAccess('timetable', ['crud']) @Delete('slots/:id') @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.timetable.removeSlot(a.schoolId, id);
  }
}

/** Class sessions: teachers run them (attendance "mark"); admins monitor them. */
@Controller('class-sessions')
export class ClassSessionsController {
  constructor(private readonly timetable: TimetableService) {}

  @RequireAccess('attendance', ['mark']) @Get('today')
  today(@CurrentAuth() a: SchoolAuth) {
    return this.timetable.teacherToday(a.schoolId, a.userId);
  }

  @RequireAccess('attendance', ['mark']) @Post('start')
  start(@CurrentAuth() a: SchoolAuth, @Body() dto: StartSessionDto) {
    return this.timetable.startSession(a.schoolId, a.userId, dto.timetableSlotId, dto.topic);
  }

  @RequireAccess('attendance', ['mark']) @Post(':id/end') @HttpCode(HttpStatus.OK)
  end(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.timetable.endSession(a.schoolId, a.userId, id);
  }

  @RequireAccess('attendance', ['crud', 'view']) @Get('monitor')
  monitor(@CurrentAuth() a: SchoolAuth, @Query() q: MonitorQuery) {
    return this.timetable.monitor(a.schoolId, q.date);
  }
}
