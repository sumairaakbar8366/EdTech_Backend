import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, DefaultValuePipe } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { AnnouncementDto, MessageDto, StartThreadDto } from './communication.dto.js';
import { CommunicationService } from './communication.service.js';
import { NotificationsService } from './notifications.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();
/** Every school role has some communication access (page 15); notifications are per user. */
const AnyRole = () => RequireAccess('communication', ['crud', 'view', 'own']);
const Manage = () => RequireAccess('communication', ['crud']);
const Converse = () => RequireAccess('communication', ['crud', 'own']);

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @AnyRole() @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return this.notifications.list(a.schoolId, a.userId, Math.max(1, page));
  }

  @AnyRole() @Get('unread-count')
  unread(@CurrentAuth() a: SchoolAuth) {
    return this.notifications.unreadCount(a.schoolId, a.userId);
  }

  @AnyRole() @Post('read-all')
  readAll(@CurrentAuth() a: SchoolAuth) {
    return this.notifications.markAllRead(a.schoolId, a.userId);
  }

  @AnyRole() @Post(':id/read')
  read(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.notifications.markRead(a.schoolId, a.userId, id);
  }
}

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly communication: CommunicationService) {}

  @AnyRole() @Get()
  list(@CurrentAuth() a: SchoolAuth) {
    return this.communication.listAnnouncements(a);
  }

  @Manage() @Post()
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: AnnouncementDto) {
    return this.communication.createAnnouncement(a, dto);
  }

  @Manage() @Delete(':id')
  remove(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.communication.deleteAnnouncement(a, id);
  }
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly communication: CommunicationService) {}

  @Converse() @Get('contacts')
  contacts(@CurrentAuth() a: SchoolAuth) {
    return this.communication.contacts(a);
  }

  @Converse() @Get('threads')
  threads(@CurrentAuth() a: SchoolAuth) {
    return this.communication.listThreads(a);
  }

  @Converse() @Post('threads')
  start(@CurrentAuth() a: SchoolAuth, @Body() dto: StartThreadDto) {
    return this.communication.startThread(a, dto);
  }

  @Converse() @Get('threads/:id')
  thread(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.communication.getThread(a, id);
  }

  @Converse() @Post('threads/:id/messages')
  reply(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: MessageDto) {
    return this.communication.reply(a, id, dto.body);
  }
}
