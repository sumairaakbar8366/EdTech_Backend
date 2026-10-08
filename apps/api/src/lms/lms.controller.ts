import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { Readable } from 'node:stream';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { AssignmentDto, AssignmentListQuery, CommentDto, CourseListQuery, GradeDto, MaterialDto, StudentQuery, SubmitDto, UpdateMaterialDto } from './lms.dto.js';
import { LMS_MAX_BYTES, LmsService } from './lms.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();
const Upload = () => UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: LMS_MAX_BYTES, files: 1 } }));
/** Per-course rules (teacher of the course, enrolled student, parent) are enforced in LmsService. */
const LmsRead = () => RequireAccess('lms', ['crud', 'view']);
const LmsWrite = () => RequireAccess('lms', ['crud']);
const AssignRead = () => RequireAccess('assignments', ['crud', 'submit', 'view']);
const AssignWrite = () => RequireAccess('assignments', ['crud']);

/** Inline for viewable types (PDF, images, video) so they open in the browser; downloads otherwise. */
function sendFile(res: Response, file: { name: string; mimeType: string; size: number }, stream: Readable) {
  const inline = /^(application\/pdf|image\/|video\/)/.test(file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  return new StreamableFile(stream, { type: file.mimeType, length: file.size, disposition: `${inline ? 'inline' : 'attachment'}; filename="${file.name.replace(/"/g, '')}"` });
}

@Controller('lms')
export class LmsController {
  constructor(private readonly lms: LmsService) {}

  // --- Courses & materials (LMS row: Admin/Teacher CRUD, Student/Parent View) ---------

  @LmsRead() @Get('courses')
  courses(@CurrentAuth() a: SchoolAuth, @Query() q: CourseListQuery) {
    return this.lms.listCourses(a, q.studentId);
  }

  @LmsRead() @Get('children')
  children(@CurrentAuth() a: SchoolAuth) {
    return this.lms.children(a);
  }

  @LmsRead() @Get('courses/:id')
  course(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Query() q: StudentQuery) {
    return this.lms.getCourse(a, id, q.studentId);
  }

  @LmsWrite() @Post('courses/:id/materials') @Upload()
  addMaterial(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: MaterialDto, @UploadedFile() file?: Express.Multer.File) {
    return this.lms.createMaterial(a, id, dto, file);
  }

  @LmsWrite() @Patch('materials/:id')
  updateMaterial(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateMaterialDto) {
    return this.lms.updateMaterial(a, id, dto);
  }

  @LmsWrite() @Delete('materials/:id') @HttpCode(HttpStatus.NO_CONTENT)
  deleteMaterial(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.lms.deleteMaterial(a, id);
  }

  @LmsRead() @Get('materials/:id/file')
  async materialFile(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.lms.openMaterial(a, id);
    return sendFile(res, file, stream);
  }

  @LmsRead() @Get('materials/:id/comments')
  comments(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.lms.listComments(a, id);
  }

  @LmsRead() @Post('materials/:id/comments')
  comment(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: CommentDto) {
    return this.lms.addComment(a, id, dto);
  }

  @LmsWrite() @Put('comments/:id/pin')
  pin(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.lms.pinComment(a, id, true);
  }

  @LmsWrite() @Delete('comments/:id/pin')
  unpin(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.lms.pinComment(a, id, false);
  }

  @LmsRead() @Delete('comments/:id') @HttpCode(HttpStatus.NO_CONTENT)
  deleteComment(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.lms.deleteComment(a, id);
  }

  // --- Assignments (Assignments row: Admin/Teacher CRUD, Student Submit, Parent View) --

  @AssignWrite() @Post('courses/:id/assignments') @Upload()
  addAssignment(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: AssignmentDto, @UploadedFile() file?: Express.Multer.File) {
    return this.lms.createAssignment(a, id, dto, file);
  }

  @AssignRead() @Get('assignments')
  myAssignments(@CurrentAuth() a: SchoolAuth, @Query() q: AssignmentListQuery) {
    return this.lms.studentAssignments(a, q.studentId);
  }

  @AssignRead() @Get('assignments/:id')
  assignment(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Query() q: StudentQuery) {
    return this.lms.getAssignment(a, id, q.studentId);
  }

  @AssignWrite() @Put('assignments/:id')
  updateAssignment(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: AssignmentDto) {
    return this.lms.updateAssignment(a, id, dto);
  }

  @AssignWrite() @Delete('assignments/:id') @HttpCode(HttpStatus.NO_CONTENT)
  deleteAssignment(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.lms.deleteAssignment(a, id);
  }

  @AssignRead() @Get('assignments/:id/file')
  async assignmentFile(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.lms.openAssignmentFile(a, id);
    return sendFile(res, file, stream);
  }

  @RequireAccess('assignments', ['submit']) @Post('assignments/:id/submit') @Upload()
  submit(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: SubmitDto, @UploadedFile() file?: Express.Multer.File) {
    return this.lms.submit(a, id, dto, file);
  }

  @AssignWrite() @Put('submissions/:id/grade')
  grade(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: GradeDto) {
    return this.lms.grade(a, id, dto);
  }

  @AssignRead() @Get('submissions/:id/file')
  async submissionFile(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.lms.openSubmissionFile(a, id);
    return sendFile(res, file, stream);
  }
}
