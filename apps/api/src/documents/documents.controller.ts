import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentAuth } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { DocumentsService, type OwnerType } from './documents.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const OWNER_TYPES = ['student', 'employee', 'guardian', 'admission_application', 'school', 'job_application'] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class OwnerQuery {
  @IsIn(OWNER_TYPES) ownerType: OwnerType;
  @IsUUID() ownerId: string;
}

class UploadDto extends OwnerQuery {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) category: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) title: string;
}

/**
 * Documents (page 14). Access is decided per owner in DocumentsService, so these routes
 * only require a signed-in school user.
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: OwnerQuery) {
    return this.documents.list(assertSchool(a), q.ownerType, q.ownerId);
  }

  @Post()
  // Hard ceiling; the configured MAX_UPLOAD_MB is enforced in the service.
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  upload(@CurrentAuth() a: SchoolAuth, @Body() dto: UploadDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    return this.documents.upload(assertSchool(a), { ...dto, file });
  }

  @Get(':id/download')
  async download(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { doc, stream } = await this.documents.open(assertSchool(a), id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream, {
      type: doc.mimeType,
      length: doc.sizeBytes,
      disposition: `attachment; filename="${doc.fileName.replace(/"/g, '')}"`,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.remove(assertSchool(a), id);
  }
}

function assertSchool(a: AuthContext): SchoolAuth {
  if (a.scope !== 'school') throw new BadRequestException('Documents belong to a school');
  return a;
}
