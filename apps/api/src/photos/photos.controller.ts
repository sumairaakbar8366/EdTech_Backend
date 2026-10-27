import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentAuth, Public, RequireAccess } from '../auth/decorators.js';
import type { AppRequest, AuthContext } from '../common/request-context.js';
import { PermissionService } from '../rbac/permission.service.js';
import { PhotosService, type PhotoSubject } from './photos.service.js';

const upload = () => UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }));

class PhotoDto {
  @IsUUID() photoId: string;
}

class DecideDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/** Signed-in school users: upload, view, set their own; admins set anyone's and decide change requests. */
@Controller('photos')
export class PhotosController {
  constructor(
    private readonly photos: PhotosService,
    private readonly permissions: PermissionService,
  ) {}

  @Post('upload') @upload()
  stage(@CurrentAuth() a: AuthContext, @UploadedFile() file?: Express.Multer.File) {
    this.photos.assertSchool(a);
    if (!file) throw new BadRequestException('Attach the picture in the "file" field');
    return this.photos.stage(a.schoolId, file);
  }

  @Post('me')
  async mine(@CurrentAuth() a: AuthContext, @Body() dto: PhotoDto) {
    this.photos.assertSchool(a);
    const { roles } = await this.permissions.loadUserAccess(a.schoolId, a.userId);
    const isAdmin = roles.some((r) => r.key === 'school_admin' || r.key === 'principal');
    return this.photos.setMine(a, dto.photoId, isAdmin);
  }

  @RequireAccess('students', ['crud']) @Post('students/:id')
  student(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoDto) {
    return this.set(a, 'student', id, dto);
  }

  @RequireAccess('students', ['crud']) @Post('guardians/:id')
  guardian(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoDto) {
    return this.set(a, 'guardian', id, dto);
  }

  @RequireAccess('staff', ['crud']) @Post('staff/:id')
  staff(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoDto) {
    return this.set(a, 'employee', id, dto);
  }

  @RequireAccess('settings', ['crud']) @Post('users/:id')
  user(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoDto) {
    return this.set(a, 'user', id, dto);
  }

  @RequireAccess('settings', ['crud']) @Get('requests')
  requests(@CurrentAuth() a: AuthContext) {
    this.photos.assertSchool(a);
    return this.photos.listRequests(a.schoolId);
  }

  @RequireAccess('settings', ['crud']) @Post('requests/:id') @HttpCode(HttpStatus.OK)
  decide(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto) {
    this.photos.assertSchool(a);
    return this.photos.decide(a, id, dto.approve, dto.note);
  }

  /** Only signed-in people of the same school; never cached by shared caches. */
  @Get(':id')
  async open(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    this.photos.assertSchool(a);
    const stream = await this.photos.open(a.schoolId, id);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }

  private set(a: AuthContext, subject: PhotoSubject, id: string, dto: PhotoDto) {
    this.photos.assertSchool(a);
    return this.photos.setFor(a.schoolId, subject, id, dto.photoId);
  }
}

/** Applicants on the school website upload their picture before sending the form. */
@Controller('public/photos')
export class PublicPhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Public() @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post() @upload()
  stage(@Req() req: AppRequest, @UploadedFile() file?: Express.Multer.File) {
    if (req.tenant?.kind !== 'school') throw new BadRequestException('Not a school address');
    if (!file) throw new BadRequestException('Attach the picture in the "file" field');
    return this.photos.stage(req.tenant.schoolId, file, true);
  }
}
