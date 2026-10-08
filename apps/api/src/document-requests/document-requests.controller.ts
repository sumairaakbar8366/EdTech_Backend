import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { CreateRequestDto, ListRequestsQuery, MoveRequestDto } from './document-requests.dto.js';
import { DocumentRequestsService } from './document-requests.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
/** Parents (their children) and students (themselves); the service checks the student link. */
const Requester = () => RequireAccess('documents', ['own', 'children']);
/** School administration processes the requests. */
const Admin = () => RequireAccess('documents', ['crud']);

@Controller('document-requests')
export class DocumentRequestsController {
  constructor(private readonly requests: DocumentRequestsService) {}

  @Requester() @Post()
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateRequestDto) {
    return this.requests.create(a, dto);
  }

  @Requester() @Get('mine')
  mine(@CurrentAuth() a: SchoolAuth) {
    return this.requests.mine(a);
  }

  @Requester() @Post(':id/cancel') @HttpCode(HttpStatus.OK)
  cancel(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.cancel(a, id);
  }

  @Admin() @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ListRequestsQuery) {
    return this.requests.list(a.schoolId, q);
  }

  @Admin() @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.requests.summary(a.schoolId);
  }

  @Admin() @Post(':id/status') @HttpCode(HttpStatus.OK)
  move(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveRequestDto) {
    return this.requests.move(a, id, dto);
  }
}
