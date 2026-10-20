import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import {
  CreateStudentDto,
  EmergencyContactDto,
  EnrollDto,
  GuardianDetailsDto,
  GuardianLinkDto,
  ListGuardiansQuery,
  ListStudentsQuery,
  LoginPasswordDto,
  PreviousSchoolDto,
  PromoteDto,
  PromotionCandidatesQuery,
  StudentLoginDto,
  StudentStatusDto,
  UpdateStudentDto,
} from './students.dto.js';
import { StudentsService } from './students.service.js';
import { TaughtStudentsService } from './taught-students.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();
const Read = () => RequireAccess('students', ['crud', 'view']);
const Write = () => RequireAccess('students', ['crud']);

/** Students module (page-15 "Students": Admin CRUD, Accounts/Teacher View, Student Own, Parent Children). */
@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly taught: TaughtStudentsService,
  ) {}

  /** Teacher "My Students": the sections the signed-in teacher teaches this year. */
  @Read() @Get('taught')
  taughtStudents(@CurrentAuth() a: SchoolAuth) {
    return this.taught.forTeacher(a.schoolId, a.userId);
  }

  @Read() @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ListStudentsQuery) {
    return this.students.list(a.schoolId, q);
  }

  @Read() @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.students.summary(a.schoolId);
  }

  @RequireAccess('students', ['own']) @Get('me')
  me(@CurrentAuth() a: SchoolAuth) {
    return this.students.getOwn(a.schoolId, a.userId);
  }

  @RequireAccess('students', ['children']) @Get('my-children')
  myChildren(@CurrentAuth() a: SchoolAuth) {
    return this.students.myChildren(a.schoolId, a.userId);
  }

  /** Per child: attendance %, fees due and the latest published result, for the parent dashboard. */
  @RequireAccess('students', ['children']) @Get('my-children/overview')
  childrenOverview(@CurrentAuth() a: SchoolAuth) {
    return this.students.childrenOverview(a.schoolId, a.userId);
  }

  @RequireAccess('students', ['children']) @Get('my-children/:id')
  child(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.students.getChild(a.schoolId, a.userId, id);
  }

  @Write() @Get('promotion-candidates')
  promotionCandidates(@CurrentAuth() a: SchoolAuth, @Query() q: PromotionCandidatesQuery) {
    return this.students.promotionCandidates(a.schoolId, q.academicYearId, q.sectionId);
  }

  @Write() @Post('promote') @HttpCode(HttpStatus.OK)
  promote(@CurrentAuth() a: SchoolAuth, @Body() dto: PromoteDto) {
    return this.students.promote(a.schoolId, dto);
  }

  @Read() @Get(':id')
  get(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.students.get(a.schoolId, id);
  }

  @Write() @Post()
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateStudentDto) {
    return this.students.create(a.schoolId, dto);
  }

  @Write() @Patch(':id')
  update(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(a.schoolId, id, dto);
  }

  @Write() @Post(':id/status') @HttpCode(HttpStatus.OK)
  status(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: StudentStatusDto) {
    return this.students.changeStatus(a.schoolId, id, dto);
  }

  @Write() @Post(':id/enrollment') @HttpCode(HttpStatus.OK)
  enroll(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: EnrollDto) {
    return this.students.enroll(a.schoolId, id, dto);
  }

  @Write() @Post(':id/login')
  login(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: StudentLoginDto) {
    return this.students.createStudentLogin(a.schoolId, id, dto);
  }

  @Write() @Post(':id/guardians')
  addGuardian(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: GuardianLinkDto) {
    return this.students.addGuardian(a.schoolId, id, dto);
  }

  @Write() @Post(':id/guardians/:gid/primary') @HttpCode(HttpStatus.OK)
  setPrimary(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Param('gid', Id()) gid: string) {
    return this.students.setPrimaryGuardian(a.schoolId, id, gid);
  }

  @Write() @Delete(':id/guardians/:gid') @HttpCode(HttpStatus.NO_CONTENT)
  unlinkGuardian(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Param('gid', Id()) gid: string) {
    return this.students.unlinkGuardian(a.schoolId, id, gid);
  }

  @Write() @Post(':id/emergency-contacts')
  addContact(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: EmergencyContactDto) {
    return this.students.addEmergencyContact(a.schoolId, id, dto);
  }

  @Write() @Delete(':id/emergency-contacts/:cid') @HttpCode(HttpStatus.NO_CONTENT)
  removeContact(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Param('cid', Id()) cid: string) {
    return this.students.removeEmergencyContact(a.schoolId, id, cid);
  }

  @Write() @Post(':id/previous-schools')
  addPrevious(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: PreviousSchoolDto) {
    return this.students.addPreviousSchool(a.schoolId, id, dto);
  }

  @Write() @Delete(':id/previous-schools/:pid') @HttpCode(HttpStatus.NO_CONTENT)
  removePrevious(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Param('pid', Id()) pid: string) {
    return this.students.removePreviousSchool(a.schoolId, id, pid);
  }
}

@Controller('guardians')
export class GuardiansController {
  constructor(private readonly students: StudentsService) {}

  @Read() @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ListGuardiansQuery) {
    return this.students.listGuardians(a.schoolId, q);
  }

  @Write() @Patch(':id')
  update(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: GuardianDetailsDto) {
    return this.students.updateGuardian(a.schoolId, id, dto);
  }

  @Write() @Post(':id/login')
  login(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: LoginPasswordDto) {
    return this.students.createGuardianLogin(a.schoolId, id, dto.password);
  }

  /** Removes a parent record that is no longer linked to any child and has no login (duplicates). */
  @Write() @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string): Promise<void> {
    await this.students.removeGuardian(a.schoolId, id);
  }
}
