import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import {
  AssignTeacherDto,
  ChangeStatusDto,
  CreateEmployeeDto,
  ExperienceDto,
  ListAssignmentsQuery,
  ListEmployeesQuery,
  QualificationDto,
  StaffLoginDto,
  UpdateEmployeeDto,
  ReplaceAdminDto,
} from './staff.dto.js';
import { StaffService } from './staff.service.js';
import { TeacherAssignmentsService } from './teacher-assignments.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();

/** Staff module (page-15 "Staff": Admin CRUD, Accounts View, Teacher/Non-teaching Own). */
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequireAccess('staff', ['crud', 'view']) @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ListEmployeesQuery) {
    return this.staff.list(a.schoolId, q);
  }

  @RequireAccess('staff', ['crud', 'view']) @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.staff.summary(a.schoolId);
  }

  /** Every administrator and principal, current and former (the principal's records). */
  @RequireAccess('staff', ['crud', 'view']) @Get('administration')
  administration(@CurrentAuth() a: SchoolAuth) {
    return this.staff.administration(a.schoolId);
  }

  @RequireAccess('staff', ['crud', 'view', 'own']) @Get('me')
  me(@CurrentAuth() a: SchoolAuth) {
    return this.staff.getOwn(a.schoolId, a.userId);
  }

  /** Periods as School Admin / Principal and their work year by year. */
  @RequireAccess('staff', ['crud', 'view']) @Get(':id/service-record')
  serviceRecord(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.staff.serviceRecord(a.schoolId, id);
  }

  @RequireAccess('staff', ['crud', 'view']) @Get(':id')
  get(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.staff.get(a.schoolId, id);
  }

  @RequireAccess('staff', ['crud']) @Post()
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateEmployeeDto) {
    return this.staff.create(a.schoolId, dto, a.userId);
  }

  @RequireAccess('staff', ['crud']) @Patch(':id')
  update(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.staff.update(a.schoolId, id, dto);
  }

  @RequireAccess('staff', ['crud']) @Post(':id/status') @HttpCode(HttpStatus.OK)
  changeStatus(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ChangeStatusDto) {
    return this.staff.changeStatus(a.schoolId, id, dto, a.userId);
  }

  /** Principal or School Admin: make a new School Admin, then suspend / release this one. */
  @RequireAccess('staff', ['crud']) @Post(':id/replace-admin') @HttpCode(HttpStatus.OK)
  replaceAdmin(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ReplaceAdminDto) {
    return this.staff.replaceAdmin(a.schoolId, id, dto, a.userId);
  }

  @RequireAccess('staff', ['crud']) @Post(':id/login')
  createLogin(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: StaffLoginDto) {
    return this.staff.createLoginFor(a.schoolId, id, dto);
  }

  @RequireAccess('staff', ['crud']) @Post(':id/qualifications')
  addQualification(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: QualificationDto) {
    return this.staff.addQualification(a.schoolId, id, dto);
  }

  @RequireAccess('staff', ['crud']) @Delete(':id/qualifications/:qid') @HttpCode(HttpStatus.NO_CONTENT)
  removeQualification(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Param('qid', Id()) qid: string) {
    return this.staff.removeQualification(a.schoolId, id, qid);
  }

  @RequireAccess('staff', ['crud']) @Post(':id/experiences')
  addExperience(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ExperienceDto) {
    return this.staff.addExperience(a.schoolId, id, dto);
  }

  @RequireAccess('staff', ['crud']) @Delete(':id/experiences/:eid') @HttpCode(HttpStatus.NO_CONTENT)
  removeExperience(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Param('eid', Id()) eid: string) {
    return this.staff.removeExperience(a.schoolId, id, eid);
  }
}

/** Teacher assignments live under Academics (page 10) and use its permissions. */
@Controller('academics/teacher-assignments')
export class TeacherAssignmentsController {
  constructor(private readonly assignments: TeacherAssignmentsService) {}

  @RequireAccess('academics', ['crud', 'view']) @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ListAssignmentsQuery) {
    return this.assignments.list(a.schoolId, q);
  }

  @RequireAccess('academics', ['crud']) @Post()
  assign(@CurrentAuth() a: SchoolAuth, @Body() dto: AssignTeacherDto) {
    return this.assignments.assign(a.schoolId, dto);
  }

  @RequireAccess('academics', ['crud']) @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.assignments.remove(a.schoolId, id);
  }
}
