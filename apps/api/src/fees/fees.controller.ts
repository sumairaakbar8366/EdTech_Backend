import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { BillingService } from './billing.service.js';
import { FeeSetupService } from './fee-setup.service.js';
import {
  AssignStructureDto,
  AwardDto,
  AwardListQuery,
  CategoryDto,
  ConcessionDto,
  GenerateInvoicesDto,
  InvoiceListQuery,
  NoteDto,
  PaymentDto,
  PaymentListQuery,
  StructureDto,
  YearQuery,
} from './fees.dto.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();

/** Fees row: Admin CRUD, Accounts CRUD, Teacher View, Student Own, Parent Children (page 15). */
@Controller('fees')
export class FeesController {
  constructor(
    private readonly setup: FeeSetupService,
    private readonly billing: BillingService,
  ) {}

  // --- Setup ---------------------------------------------------------------------------

  @RequireAccess('fees', ['crud', 'view']) @Get('categories')
  categories(@CurrentAuth() a: SchoolAuth) {
    return this.setup.listCategories(a.schoolId);
  }

  @RequireAccess('fees', ['crud']) @Post('categories')
  createCategory(@CurrentAuth() a: SchoolAuth, @Body() dto: CategoryDto) {
    return this.setup.createCategory(a.schoolId, dto);
  }

  @RequireAccess('fees', ['crud']) @Patch('categories/:id')
  updateCategory(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: CategoryDto) {
    return this.setup.updateCategory(a.schoolId, id, dto);
  }

  @RequireAccess('fees', ['crud', 'view']) @Get('structures')
  structures(@CurrentAuth() a: SchoolAuth, @Query() q: YearQuery) {
    return this.setup.listStructures(a.schoolId, q.academicYearId);
  }

  @RequireAccess('fees', ['crud']) @Post('structures')
  createStructure(@CurrentAuth() a: SchoolAuth, @Body() dto: StructureDto) {
    return this.setup.createStructure(a.schoolId, dto);
  }

  @RequireAccess('fees', ['crud']) @Put('structures/:id')
  updateStructure(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: StructureDto) {
    return this.setup.updateStructure(a.schoolId, id, dto);
  }

  @RequireAccess('fees', ['crud']) @Post('structures/:id/assign') @HttpCode(HttpStatus.OK)
  assign(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: AssignStructureDto) {
    return this.setup.assign(a.schoolId, id, dto);
  }

  @RequireAccess('fees', ['crud']) @Delete('structures/:id/students/:studentId') @HttpCode(HttpStatus.NO_CONTENT)
  unassign(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Param('studentId', Id()) studentId: string) {
    return this.setup.unassign(a.schoolId, id, studentId);
  }

  @RequireAccess('fees', ['crud', 'view']) @Get('concessions')
  concessions(@CurrentAuth() a: SchoolAuth) {
    return this.setup.listConcessions(a.schoolId);
  }

  @RequireAccess('fees', ['crud']) @Post('concessions')
  createConcession(@CurrentAuth() a: SchoolAuth, @Body() dto: ConcessionDto) {
    return this.setup.createConcession(a.schoolId, dto);
  }

  @RequireAccess('fees', ['crud']) @Patch('concessions/:id')
  updateConcession(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ConcessionDto) {
    return this.setup.updateConcession(a.schoolId, id, dto);
  }

  @RequireAccess('fees', ['crud', 'view']) @Get('awards')
  awards(@CurrentAuth() a: SchoolAuth, @Query() q: AwardListQuery) {
    return this.setup.listAwards(a.schoolId, q.studentId);
  }

  @RequireAccess('fees', ['crud']) @Post('awards')
  grantAward(@CurrentAuth() a: SchoolAuth, @Body() dto: AwardDto) {
    return this.setup.grantAward(a.schoolId, dto, a.userId);
  }

  @RequireAccess('fees', ['crud']) @Post('awards/:id/revoke') @HttpCode(HttpStatus.OK)
  revokeAward(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.setup.revokeAward(a.schoolId, id);
  }

  // --- Invoices ------------------------------------------------------------------------

  @RequireAccess('fees', ['crud']) @Post('invoices/generate')
  generate(@CurrentAuth() a: SchoolAuth, @Body() dto: GenerateInvoicesDto) {
    return this.billing.generate(a.schoolId, dto, a.userId);
  }

  @RequireAccess('fees', ['crud', 'view']) @Get('invoices')
  invoices(@CurrentAuth() a: SchoolAuth, @Query() q: InvoiceListQuery) {
    return this.billing.listInvoices(a.schoolId, q);
  }

  @RequireAccess('fees', ['crud', 'view', 'own', 'children']) @Get('invoices/:id')
  invoice(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.billing.getInvoice(a, id);
  }

  @RequireAccess('fees', ['crud']) @Post('invoices/:id/waive') @HttpCode(HttpStatus.OK)
  waive(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: NoteDto) {
    return this.billing.waive(a.schoolId, id, dto.note);
  }

  @RequireAccess('fees', ['crud']) @Post('invoices/:id/cancel') @HttpCode(HttpStatus.OK)
  cancel(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: NoteDto) {
    return this.billing.cancel(a.schoolId, id, dto.note);
  }

  // --- Payments ------------------------------------------------------------------------

  @RequireAccess('fees', ['crud']) @Post('payments')
  pay(@CurrentAuth() a: SchoolAuth, @Body() dto: PaymentDto) {
    return this.billing.recordPayment(a.schoolId, dto, a.userId);
  }

  @RequireAccess('fees', ['crud', 'view']) @Get('payments')
  payments(@CurrentAuth() a: SchoolAuth, @Query() q: PaymentListQuery) {
    return this.billing.listPayments(a.schoolId, q);
  }

  @RequireAccess('fees', ['crud']) @Post('payments/:id/void') @HttpCode(HttpStatus.OK)
  voidPayment(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: NoteDto) {
    return this.billing.voidPayment(a.schoolId, id, dto.note);
  }

  @RequireAccess('fees', ['crud', 'view', 'own', 'children']) @Get('payments/:id/receipt')
  receipt(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.billing.receipt(a, id);
  }

  // --- Statements ----------------------------------------------------------------------

  @RequireAccess('fees', ['crud', 'view', 'own', 'children']) @Get('students/:id/statement')
  statement(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.billing.statement(a, id);
  }

  @RequireAccess('fees', ['own', 'children']) @Get('my-students')
  myStudents(@CurrentAuth() a: SchoolAuth) {
    return this.billing.ownStudents(a.schoolId, a.userId);
  }

  @RequireAccess('fees', ['crud', 'view']) @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.billing.summary(a.schoolId);
  }
}
