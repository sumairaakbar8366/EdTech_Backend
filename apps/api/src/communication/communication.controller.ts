import { Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, DefaultValuePipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import type { Env } from '../config/env.js';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { AnnouncementDto, MessageDto, PeopleSearchQuery, StartThreadDto } from './communication.dto.js';
import { CommunicationService } from './communication.service.js';
import { NotificationsService } from './notifications.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();
/** Every school role has some communication access (page 15); notifications are per user. */
const AnyRole = () => RequireAccess('communication', ['crud', 'view', 'own']);
const Manage = () => RequireAccess('communication', ['crud']);
const Converse = () => RequireAccess('communication', ['crud', 'own']);

class PushKeysDto {
  @IsString() @MaxLength(200) p256dh: string;
  @IsString() @MaxLength(200) auth: string;
}

class PushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false }) @MaxLength(1000) endpoint: string;
  @ValidateNested() @Type(() => PushKeysDto) keys: PushKeysDto;
}

class PushEndpointDto {
  @IsString() @MaxLength(1000) endpoint: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

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

  /** The public VAPID key browsers need to subscribe (null when push is not set up on this server). */
  @AnyRole() @Get('push/key')
  pushKey() {
    return { publicKey: this.config.get('PUSH_DRIVER', { infer: true }) === 'webpush' ? this.config.get('VAPID_PUBLIC_KEY', { infer: true }) ?? null : null };
  }

  @AnyRole() @Post('push/subscribe')
  subscribe(@CurrentAuth() a: SchoolAuth, @Body() dto: PushSubscriptionDto, @Headers('user-agent') ua?: string) {
    return this.notifications.subscribePush(a.schoolId, a.userId, dto, ua ?? null);
  }

  @AnyRole() @Post('push/unsubscribe')
  unsubscribe(@CurrentAuth() a: SchoolAuth, @Body() dto: PushEndpointDto) {
    return this.notifications.unsubscribePush(a.schoolId, a.userId, dto.endpoint);
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

  @Manage() @Get('people')
  people(@CurrentAuth() a: SchoolAuth, @Query() q: PeopleSearchQuery) {
    return this.communication.searchPeople(a, q);
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
