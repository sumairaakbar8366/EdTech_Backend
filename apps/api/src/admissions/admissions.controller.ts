import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import {
  ApplicationDto,
  AssessmentDto,
  AssessmentResultDto,
  EnrollApplicantDto,
  ListApplicationsQuery,
  MoveAdmissionDto,
} from './admissions.dto.js';
import { AdmissionsService } from './admissions.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();
const Read = () => RequireAccess('admissions', ['crud', 'view']);
const Write = () => RequireAccess('admissions', ['crud']);

/** Admissions (page-15: Admin CRUD, Accounts View). Enrolling an approved applicant is part of this workflow. */
@Controller('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Read() @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ListApplicationsQuery) {
    return this.admissions.list(a.schoolId, q);
  }

  @Read() @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.admissions.summary(a.schoolId);
  }

  @Read() @Get(':id')
  get(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.admissions.get(a.schoolId, id);
  }

  @Write() @Post()
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: ApplicationDto) {
    return this.admissions.create(a.schoolId, dto, a.userId);
  }

  @Write() @Patch(':id')
  update(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ApplicationDto) {
    return this.admissions.update(a.schoolId, id, dto);
  }

  @Write() @Post(':id/status') @HttpCode(HttpStatus.OK)
  move(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: MoveAdmissionDto) {
    return this.admissions.move(a.schoolId, id, dto, a.userId);
  }

  @Write() @Post(':id/assessments')
  schedule(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: AssessmentDto) {
    return this.admissions.scheduleAssessment(a.schoolId, id, dto, a.userId);
  }

  @Write() @Patch('assessments/:id')
  record(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: AssessmentResultDto) {
    return this.admissions.recordAssessment(a.schoolId, id, dto);
  }

  @Write() @Post(':id/enroll')
  enroll(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: EnrollApplicantDto) {
    return this.admissions.enroll(a.schoolId, id, dto, a.userId);
  }
}
