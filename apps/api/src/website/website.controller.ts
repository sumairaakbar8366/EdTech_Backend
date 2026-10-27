import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentAuth, Public, RequireAccess } from '../auth/decorators.js';
import type { AppRequest, AuthContext } from '../common/request-context.js';
import { AdmissionFormDto } from '../admissions/admission-form.js';
import { MAX_APPLICATION_FILE_BYTES, MediaUploadDto, PublicAdmissionDto, PublicCareerDto, WebsiteDto, WebsiteService } from './website.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Manage = () => RequireAccess('settings', ['crud']);

function schoolOf(req: AppRequest): string {
  if (req.tenant?.kind !== 'school') throw new BadRequestException('Not a school address');
  return req.tenant.schoolId;
}

/** School admin: website texts, switches and photo gallery. */
@Controller('website')
export class WebsiteAdminController {
  constructor(private readonly website: WebsiteService) {}

  @Manage() @Get()
  get(@CurrentAuth() a: SchoolAuth) {
    return this.website.get(a.schoolId);
  }

  @Manage() @Put()
  update(@CurrentAuth() a: SchoolAuth, @Body() dto: WebsiteDto) {
    return this.website.update(a.schoolId, dto);
  }

  /** The school's online admission form: standard fields shown/required, and its own fields. */
  @Manage() @Get('admission-form')
  admissionForm(@CurrentAuth() a: SchoolAuth) {
    return this.website.admissionForm(a.schoolId);
  }

  @Manage() @Put('admission-form')
  saveAdmissionForm(@CurrentAuth() a: SchoolAuth, @Body() dto: AdmissionFormDto) {
    return this.website.saveAdmissionForm(a.schoolId, dto);
  }

  @Manage() @Post('media')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 9 * 1024 * 1024, files: 1 } }))
  upload(@CurrentAuth() a: SchoolAuth, @Body() dto: MediaUploadDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach the photo in the "file" field');
    return this.website.upload(a.schoolId, a.userId, dto, file);
  }

  @Manage() @Delete('media/:id') @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.website.removeMedia(a.schoolId, id);
  }
}

/** The school's public website: no sign-in; the school comes from the address. */
@Controller('public')
export class WebsitePublicController {
  constructor(private readonly website: WebsiteService) {}

  @Public() @Get('site')
  site(@Req() req: AppRequest) {
    return this.website.site(schoolOf(req));
  }

  @Public() @Get('media/:id')
  async media(@Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { mimeType, stream } = await this.website.openMedia(schoolOf(req), id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }

  @Public() @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('admissions')
  admission(@Req() req: AppRequest, @Body() dto: PublicAdmissionDto) {
    return this.website.applyForAdmission(schoolOf(req), dto);
  }

  /** A document for the admission form, uploaded before the form is sent (one per request). */
  @Public() @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('admission-files')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_APPLICATION_FILE_BYTES + 1024, files: 1 } }))
  admissionFile(@Req() req: AppRequest, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach the document in the "file" field');
    return this.website.stageApplicationFile(schoolOf(req), file);
  }

  @Public() @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('careers/:postId/apply')
  career(@Req() req: AppRequest, @Param('postId', ParseUUIDPipe) postId: string, @Body() dto: PublicCareerDto) {
    return this.website.applyForJob(schoolOf(req), postId, dto);
  }
}
