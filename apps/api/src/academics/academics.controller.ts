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
} from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import {
  CreateAcademicYearDto,
  CreateClassDto,
  CreateRoomDto,
  CreateSectionDto,
  CreateSubjectDto,
  CreateTermDto,
  ListSectionsQuery,
  SetClassSubjectsDto,
  UpdateAcademicYearDto,
  UpdateClassDto,
  UpdateRoomDto,
  UpdateSectionDto,
  UpdateSubjectDto,
  UpdateTermDto,
} from './academics.dto.js';
import { AcademicStructureService } from './academic-structure.service.js';
import { AcademicYearsService } from './academic-years.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;

/** Reads need academics view or CRUD; writes need CRUD (approved "academics" matrix row). */
const Read = () => RequireAccess('academics', ['crud', 'view']);
const Write = () => RequireAccess('academics', ['crud']);
const Id = () => new ParseUUIDPipe();

@Controller('academics')
export class AcademicsController {
  constructor(
    private readonly years: AcademicYearsService,
    private readonly structure: AcademicStructureService,
  ) {}

  @Read() @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.structure.summary(a.schoolId);
  }

  // --- Academic years & terms ---
  @Read() @Get('years')
  listYears(@CurrentAuth() a: SchoolAuth) {
    return this.years.list(a.schoolId);
  }

  @Write() @Post('years')
  createYear(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateAcademicYearDto) {
    return this.years.create(a.schoolId, dto);
  }

  @Write() @Patch('years/:id')
  updateYear(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateAcademicYearDto) {
    return this.years.update(a.schoolId, id, dto);
  }

  @Write() @Post('years/:id/set-current') @HttpCode(HttpStatus.OK)
  setCurrentYear(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.years.setCurrent(a.schoolId, id);
  }

  @Write() @Delete('years/:id') @HttpCode(HttpStatus.NO_CONTENT)
  removeYear(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.years.remove(a.schoolId, id);
  }

  @Write() @Post('years/:id/terms')
  createTerm(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: CreateTermDto) {
    return this.years.createTerm(a.schoolId, id, dto);
  }

  @Write() @Patch('terms/:id')
  updateTerm(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateTermDto) {
    return this.years.updateTerm(a.schoolId, id, dto);
  }

  @Write() @Delete('terms/:id') @HttpCode(HttpStatus.NO_CONTENT)
  removeTerm(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.years.removeTerm(a.schoolId, id);
  }

  // --- Classes ---
  @Read() @Get('classes')
  listClasses(@CurrentAuth() a: SchoolAuth) {
    return this.structure.listClasses(a.schoolId);
  }

  @Write() @Post('classes')
  createClass(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateClassDto) {
    return this.structure.createClass(a.schoolId, dto);
  }

  @Write() @Patch('classes/:id')
  updateClass(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateClassDto) {
    return this.structure.updateClass(a.schoolId, id, dto);
  }

  @Write() @Delete('classes/:id') @HttpCode(HttpStatus.NO_CONTENT)
  removeClass(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.structure.removeClass(a.schoolId, id);
  }

  @Write() @Put('classes/:id/subjects')
  setClassSubjects(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: SetClassSubjectsDto) {
    return this.structure.setClassSubjects(a.schoolId, id, dto.subjectIds);
  }

  // --- Sections ---
  @Read() @Get('sections')
  listSections(@CurrentAuth() a: SchoolAuth, @Query() query: ListSectionsQuery) {
    return this.structure.listSections(a.schoolId, query);
  }

  @Write() @Post('sections')
  createSection(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateSectionDto) {
    return this.structure.createSection(a.schoolId, dto);
  }

  @Write() @Patch('sections/:id')
  updateSection(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateSectionDto) {
    return this.structure.updateSection(a.schoolId, id, dto);
  }

  @Write() @Delete('sections/:id') @HttpCode(HttpStatus.NO_CONTENT)
  removeSection(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.structure.removeSection(a.schoolId, id);
  }

  // --- Subjects ---
  @Read() @Get('subjects')
  listSubjects(@CurrentAuth() a: SchoolAuth) {
    return this.structure.listSubjects(a.schoolId);
  }

  @Write() @Post('subjects')
  createSubject(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateSubjectDto) {
    return this.structure.createSubject(a.schoolId, dto);
  }

  @Write() @Patch('subjects/:id')
  updateSubject(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateSubjectDto) {
    return this.structure.updateSubject(a.schoolId, id, dto);
  }

  @Write() @Delete('subjects/:id') @HttpCode(HttpStatus.NO_CONTENT)
  removeSubject(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.structure.removeSubject(a.schoolId, id);
  }

  // --- Rooms ---
  @Read() @Get('rooms')
  listRooms(@CurrentAuth() a: SchoolAuth) {
    return this.structure.listRooms(a.schoolId);
  }

  @Write() @Post('rooms')
  createRoom(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateRoomDto) {
    return this.structure.createRoom(a.schoolId, dto);
  }

  @Write() @Patch('rooms/:id')
  updateRoom(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateRoomDto) {
    return this.structure.updateRoom(a.schoolId, id, dto);
  }

  @Write() @Delete('rooms/:id') @HttpCode(HttpStatus.NO_CONTENT)
  removeRoom(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.structure.removeRoom(a.schoolId, id);
  }
}
