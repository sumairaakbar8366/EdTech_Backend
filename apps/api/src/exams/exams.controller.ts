import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { ExamDto, ExamListQuery, GradingScaleDto, MarksheetDto, MarksheetQuery, PapersDto, RemarksDto, SectionQuery, StudentQuery } from './exams.dto.js';
import { ExamsService } from './exams.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();

/**
 * Exams row (page 15): Admin CRUD, Teacher/Student/Parent View.
 * Results row: Admin CRUD, Teacher Enter, Student/Parent View (published only).
 */
@Controller('exams')
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @RequireAccess('exams', ['crud', 'view']) @Get('grading-scale')
  scale(@CurrentAuth() a: SchoolAuth) {
    return this.exams.gradingScale(a.schoolId);
  }

  @RequireAccess('exams', ['crud']) @Put('grading-scale')
  setScale(@CurrentAuth() a: SchoolAuth, @Body() dto: GradingScaleDto) {
    return this.exams.setGradingScale(a.schoolId, dto);
  }

  // --- Report cards for students and parents (static paths before :id) --------------

  @RequireAccess('results', ['view', 'crud', 'enter']) @Get('report-cards/mine')
  mine(@CurrentAuth() a: SchoolAuth, @Query() q: StudentQuery) {
    return this.exams.myReportCards(a, q.studentId);
  }

  @RequireAccess('results', ['view', 'crud', 'enter']) @Get('report-cards/children')
  children(@CurrentAuth() a: SchoolAuth) {
    return this.exams.children(a);
  }

  @RequireAccess('results', ['view', 'crud', 'enter']) @Get('report-cards/:id')
  card(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.exams.reportCard(a, id);
  }

  @RequireAccess('results', ['crud']) @Patch('report-cards/:id')
  remarks(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: RemarksDto) {
    return this.exams.setRemarks(a.schoolId, id, dto.remarks ?? null);
  }

  // --- Exams --------------------------------------------------------------------------

  @RequireAccess('exams', ['crud', 'view']) @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ExamListQuery) {
    return this.exams.list(a.schoolId, q.academicYearId);
  }

  @RequireAccess('exams', ['crud']) @Post()
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: ExamDto) {
    return this.exams.create(a.schoolId, dto, a.userId);
  }

  @RequireAccess('exams', ['crud', 'view']) @Get(':id')
  get(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.exams.get(a.schoolId, id);
  }

  @RequireAccess('exams', ['crud']) @Put(':id')
  update(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ExamDto) {
    return this.exams.update(a.schoolId, id, dto);
  }

  @RequireAccess('exams', ['crud']) @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.exams.remove(a.schoolId, id);
  }

  @RequireAccess('exams', ['crud']) @Put(':id/classes/:classId/papers')
  papers(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Param('classId', Id()) classId: string, @Body() dto: PapersDto) {
    return this.exams.setPapers(a.schoolId, id, classId, dto);
  }

  // --- Marks & results ----------------------------------------------------------------

  @RequireAccess('results', ['crud', 'enter']) @Get(':id/marksheet')
  marksheet(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Query() q: MarksheetQuery) {
    return this.exams.marksheet(a, id, q.sectionId, q.subjectId);
  }

  @RequireAccess('results', ['crud', 'enter']) @Put(':id/marksheet')
  saveMarks(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: MarksheetDto) {
    return this.exams.saveMarks(a, id, dto);
  }

  @RequireAccess('results', ['crud', 'enter']) @Get(':id/progress')
  progress(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.exams.progress(a, id);
  }

  @RequireAccess('results', ['crud']) @Post(':id/report-cards') @HttpCode(HttpStatus.OK)
  generate(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.exams.generate(a.schoolId, id);
  }

  @RequireAccess('results', ['crud', 'enter']) @Get(':id/report-cards')
  cards(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Query() q: SectionQuery) {
    return this.exams.reportCards(a, id, q.sectionId);
  }

  @RequireAccess('results', ['crud']) @Post(':id/publish') @HttpCode(HttpStatus.OK)
  publish(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.exams.publish(a.schoolId, id);
  }

  @RequireAccess('results', ['crud']) @Post(':id/unpublish') @HttpCode(HttpStatus.OK)
  unpublish(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.exams.unpublish(a.schoolId, id);
  }
}
