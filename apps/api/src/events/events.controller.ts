import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { EventDto, EventsService } from './events.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Manage = () => RequireAccess('communication', ['crud']);

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Manage() @Get() list(@CurrentAuth() a: SchoolAuth) { return this.events.list(a.schoolId); }
  @Manage() @Get('meta') meta() { return this.events.meta(); }
  @Manage() @Post() create(@CurrentAuth() a: SchoolAuth, @Body() dto: EventDto) { return this.events.create(a.schoolId, a.userId, dto); }
  @Manage() @Put(':id') update(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EventDto) { return this.events.update(a.schoolId, id, dto); }
  @Manage() @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) async remove(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string): Promise<void> { await this.events.remove(a.schoolId, id); }
}
