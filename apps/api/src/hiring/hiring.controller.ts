import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import {
  ApplicationDetailsDto,
  ListApplicationsQuery,
  CreateJobPostDto,
  HireDto,
  InterviewResultDto,
  MoveApplicationDto,
  ScheduleInterviewDto,
  UpdateJobPostDto,
} from './hiring.dto.js';
import { HiringService } from './hiring.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();
const Read = () => RequireAccess('staff', ['crud', 'view']);
const Write = () => RequireAccess('staff', ['crud']);

/** Hiring is part of the Staff module and uses its permissions. */
@Controller('hiring')
export class HiringController {
  constructor(private readonly hiring: HiringService) {}

  @Read() @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.hiring.summary(a.schoolId);
  }

  @Read() @Get('posts')
  listPosts(@CurrentAuth() a: SchoolAuth) {
    return this.hiring.listPosts(a.schoolId);
  }

  @Write() @Post('posts')
  createPost(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateJobPostDto) {
    return this.hiring.createPost(a.schoolId, dto);
  }

  @Write() @Patch('posts/:id')
  updatePost(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateJobPostDto) {
    return this.hiring.updatePost(a.schoolId, id, dto);
  }

  /** The hiring log: every application with its status, filterable by post and status. */
  @Read() @Get('applications')
  listAll(@CurrentAuth() a: SchoolAuth, @Query() q: ListApplicationsQuery) {
    return this.hiring.listAll(a.schoolId, q);
  }

  /** Full applicant profile (any stage). */
  @Read() @Get('applications/:id')
  getApplication(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.hiring.getApplication(a.schoolId, id);
  }

  @Read() @Get('posts/:id/applications')
  listApplications(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.hiring.listApplications(a.schoolId, id);
  }

  @Write() @Post('posts/:id/applications')
  addApplication(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ApplicationDetailsDto) {
    return this.hiring.addApplication(a.schoolId, id, dto, 'office', a.userId);
  }

  @Write() @Patch('applications/:id')
  updateApplication(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ApplicationDetailsDto) {
    return this.hiring.updateApplication(a.schoolId, id, dto);
  }

  @Write() @Post('applications/:id/status') @HttpCode(HttpStatus.OK)
  move(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: MoveApplicationDto) {
    return this.hiring.move(a.schoolId, id, dto, a.userId);
  }

  @Write() @Post('applications/:id/interviews')
  schedule(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ScheduleInterviewDto) {
    return this.hiring.scheduleInterview(a.schoolId, id, dto, a.userId);
  }

  @Write() @Patch('interviews/:id')
  record(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: InterviewResultDto) {
    return this.hiring.recordInterview(a.schoolId, id, dto, a.userId);
  }

  @Write() @Post('applications/:id/hire')
  hire(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: HireDto) {
    return this.hiring.hire(a.schoolId, id, dto, a.userId);
  }
}
