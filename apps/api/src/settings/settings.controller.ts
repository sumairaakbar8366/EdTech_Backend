import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentAuth, Public, RequireAccess } from '../auth/decorators.js';
import type { AppRequest, AuthContext } from '../common/request-context.js';
import { DomainDto, NotificationChannelsDto, SchoolSettingsDto } from './settings.dto.js';
import { SettingsService } from './settings.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();
const Manage = () => RequireAccess('settings', ['crud']);

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Manage() @Get('school')
  get(@CurrentAuth() a: SchoolAuth) {
    return this.settings.get(a.schoolId);
  }

  @Manage() @Patch('school')
  update(@CurrentAuth() a: SchoolAuth, @Body() dto: SchoolSettingsDto) {
    return this.settings.update(a.schoolId, dto);
  }

  /** Notification channels: email always; the admin picks SMS or WhatsApp (or off) for mobile messages. */
  @Manage() @Get('notifications')
  notifications(@CurrentAuth() a: SchoolAuth) {
    return this.settings.notificationChannels(a.schoolId);
  }

  @Manage() @Patch('notifications')
  setNotifications(@CurrentAuth() a: SchoolAuth, @Body() dto: NotificationChannelsDto) {
    return this.settings.setMobileChannel(a.schoolId, dto.mobileChannel);
  }

  @Manage() @Post('school/logo')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  logo(@CurrentAuth() a: SchoolAuth, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach the logo in the "file" field');
    return this.settings.setLogo(a.schoolId, file);
  }

  @Manage() @Delete('school/logo')
  removeLogo(@CurrentAuth() a: SchoolAuth) {
    return this.settings.removeLogo(a.schoolId);
  }

  @Manage() @Post('domains')
  addDomain(@CurrentAuth() a: SchoolAuth, @Body() dto: DomainDto) {
    return this.settings.addDomain(a.schoolId, dto.hostname);
  }

  @Manage() @Post('domains/:id/verify')
  verify(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.settings.verifyDomain(a.schoolId, id);
  }

  @Manage() @Post('domains/:id/primary')
  primary(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.settings.makePrimary(a.schoolId, id);
  }

  @Manage() @Delete('domains/:id')
  removeDomain(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.settings.removeDomain(a.schoolId, id);
  }
}

/** The school logo is public: it is shown on the school's sign-in page. */
@Controller('tenant/logo')
export class LogoController {
  constructor(private readonly settings: SettingsService) {}

  @Public() @Get(':id')
  async logo(@Req() req: AppRequest, @Param('id', Id()) id: string, @Res({ passthrough: true }) res: Response) {
    const tenant = req.tenant;
    if (tenant?.kind !== 'school') throw new BadRequestException('Not a school address');
    const stream = await this.settings.openLogo(tenant.schoolId, id);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }
}
