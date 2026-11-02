import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { CustomFormDto } from '../common/custom-form.js';
import { badKind, FormsService, isFormKind, type Subject } from './forms.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
/** Designing a form is for the people who register others: the admin and the principal. */
const Design = () => RequireAccess('staff', ['crud']);
const Id = () => new ParseUUIDPipe();

@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Design() @Get()
  all(@CurrentAuth() a: SchoolAuth) {
    return this.forms.all(a.schoolId);
  }

  // Answers to a person's custom fields. Staff records need staff access; student and parent records need student access.
  @RequireAccess('staff', ['crud', 'view', 'own']) @Get('answers/employee/:id')
  employee(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.forms.answers(a.schoolId, 'employee', id);
  }

  @RequireAccess('staff', ['crud']) @Put('answers/employee/:id')
  saveEmployee(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() body: { answers?: unknown }) {
    return this.forms.saveAnswers(a.schoolId, 'employee', id, body.answers);
  }

  @RequireAccess('students', ['crud', 'view', 'own', 'children']) @Get('answers/:subject/:id')
  person(@CurrentAuth() a: SchoolAuth, @Param('subject') subject: string, @Param('id', Id()) id: string) {
    return this.forms.answers(a.schoolId, studentSubject(subject), id);
  }

  @RequireAccess('students', ['crud']) @Put('answers/:subject/:id')
  savePerson(@CurrentAuth() a: SchoolAuth, @Param('subject') subject: string, @Param('id', Id()) id: string, @Body() body: { answers?: unknown }) {
    return this.forms.saveAnswers(a.schoolId, studentSubject(subject), id, body.answers);
  }

  @Design() @Get(':kind')
  one(@CurrentAuth() a: SchoolAuth, @Param('kind') kind: string) {
    if (!isFormKind(kind)) badKind(kind);
    return this.forms.get(a.schoolId, kind);
  }

  @Design() @Put(':kind')
  save(@CurrentAuth() a: SchoolAuth, @Param('kind') kind: string, @Body() dto: CustomFormDto) {
    if (!isFormKind(kind)) badKind(kind);
    return this.forms.save(a.schoolId, a.userId, kind, dto);
  }
}

function studentSubject(s: string): Subject {
  if (s === 'student' || s === 'guardian') return s;
  return badKind(s);
}
