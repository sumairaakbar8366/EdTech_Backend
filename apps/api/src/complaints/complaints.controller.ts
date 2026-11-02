import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { ComplaintListQuery, ComplaintMessageDto, CreateComplaintDto, PeopleQuery, SetComplaintStatusDto } from './complaints.dto.js';
import { ComplaintsService } from './complaints.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
/** Everyone can raise and follow their own complaints (own); the principal and admin handle them (crud). */
const Own = () => RequireAccess('complaints', ['crud', 'own']);
const Handle = () => RequireAccess('complaints', ['crud']);
const Id = () => new ParseUUIDPipe();

@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Own() @Get('meta')
  meta() {
    return this.complaints.meta();
  }

  @Own() @Get('people')
  people(@CurrentAuth() a: SchoolAuth, @Query() q: PeopleQuery) {
    return this.complaints.people(a.schoolId, a.userId, q);
  }

  @Own() @Post()
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateComplaintDto) {
    return this.complaints.create(a.schoolId, a.userId, dto);
  }

  // --- My complaints (the complainant) ---
  @Own() @Get('mine')
  mine(@CurrentAuth() a: SchoolAuth) {
    return this.complaints.mine(a.schoolId, a.userId);
  }

  @Own() @Get('mine/:id')
  mineOne(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.complaints.mineOne(a.schoolId, a.userId, id);
  }

  @Own() @Post('mine/:id/messages') @HttpCode(HttpStatus.OK)
  reply(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ComplaintMessageDto) {
    return this.complaints.reply(a.schoolId, a.userId, id, dto);
  }

  // --- Sent to me (parents who were written to) ---
  @Own() @Get('groups')
  groups(@CurrentAuth() a: SchoolAuth) {
    return this.complaints.groups(a.schoolId, a.userId);
  }

  @Own() @Get('received')
  received(@CurrentAuth() a: SchoolAuth) {
    return this.complaints.received(a.schoolId, a.userId);
  }

  @Own() @Get('received/:id')
  receivedOne(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.complaints.receivedOne(a.schoolId, a.userId, id);
  }

  @Own() @Post('received/:id/messages') @HttpCode(HttpStatus.OK)
  replyReceived(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ComplaintMessageDto) {
    return this.complaints.replyReceived(a.schoolId, a.userId, id, dto);
  }

  // --- The queue (principal / admin) ---
  @Handle() @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.complaints.summary(a.schoolId, a.userId);
  }

  @Handle() @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ComplaintListQuery) {
    return this.complaints.list(a.schoolId, a.userId, q);
  }

  @Handle() @Get(':id')
  one(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.complaints.one(a.schoolId, a.userId, id);
  }

  @Handle() @Post(':id/messages') @HttpCode(HttpStatus.OK)
  handle(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ComplaintMessageDto) {
    return this.complaints.handle(a.schoolId, a.userId, id, dto);
  }

  @Handle() @Post(':id/status') @HttpCode(HttpStatus.OK)
  status(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: SetComplaintStatusDto) {
    return this.complaints.setStatus(a.schoolId, a.userId, id, dto);
  }
}
