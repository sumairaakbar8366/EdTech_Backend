import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { BankAccountDto, BankAccountsService, ReviewBankAccountDto } from './bank-accounts.service.js';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { AdjustItemDto, CreateRunDto, PayRunDto, RunNoteDto, SalaryStructureDto } from './payroll.dto.js';
import { PayrollService } from './payroll.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();

/** Payroll row (page 15): Admin Approve, Accounts CRUD, Teacher / Non-teaching Own. */
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly bank: BankAccountsService,
  ) {}

  // --- Bank accounts (staff submit, Accounts approves) ----------------------------------

  @RequireAccess('payroll', ['own', 'crud', 'approve']) @Get('bank-accounts/me')
  myBank(@CurrentAuth() a: SchoolAuth) {
    return this.bank.mine(a.schoolId, a.userId);
  }

  @RequireAccess('payroll', ['own', 'crud', 'approve']) @Post('bank-accounts/me')
  submitBank(@CurrentAuth() a: SchoolAuth, @Body() dto: BankAccountDto) {
    return this.bank.submit(a.schoolId, a.userId, dto);
  }

  @RequireAccess('payroll', ['own', 'crud', 'approve']) @Delete('bank-accounts/me/pending') @HttpCode(HttpStatus.NO_CONTENT)
  async cancelBank(@CurrentAuth() a: SchoolAuth): Promise<void> {
    await this.bank.cancelMine(a.schoolId, a.userId);
  }

  @RequireAccess('payroll', ['crud', 'approve']) @Get('bank-accounts')
  listBank(@CurrentAuth() a: SchoolAuth, @Query('status') status?: string) {
    return this.bank.list(a.schoolId, ['pending', 'approved', 'rejected', 'replaced'].includes(status ?? '') ? status : undefined);
  }

  @RequireAccess('payroll', ['crud']) @Post('bank-accounts/:id/review') @HttpCode(HttpStatus.OK)
  reviewBank(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: ReviewBankAccountDto) {
    return this.bank.review(a.schoolId, a.userId, id, dto);
  }

  @RequireAccess('payroll', ['crud']) @Put('bank-accounts/employee/:employeeId')
  setBank(@CurrentAuth() a: SchoolAuth, @Param('employeeId', Id()) employeeId: string, @Body() dto: BankAccountDto) {
    return this.bank.setForEmployee(a.schoolId, a.userId, employeeId, dto);
  }

  @RequireAccess('payroll', ['crud', 'approve']) @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.payroll.summary(a.schoolId);
  }

  // --- Salary structures --------------------------------------------------------------

  @RequireAccess('payroll', ['crud', 'approve']) @Get('structures')
  structures(@CurrentAuth() a: SchoolAuth) {
    return this.payroll.listStructures(a.schoolId);
  }

  @RequireAccess('payroll', ['crud', 'approve']) @Get('structures/:employeeId/history')
  history(@CurrentAuth() a: SchoolAuth, @Param('employeeId', Id()) employeeId: string) {
    return this.payroll.structureHistory(a.schoolId, employeeId);
  }

  @RequireAccess('payroll', ['crud']) @Put('structures/:employeeId')
  setStructure(@CurrentAuth() a: SchoolAuth, @Param('employeeId', Id()) employeeId: string, @Body() dto: SalaryStructureDto) {
    return this.payroll.setStructure(a.schoolId, employeeId, dto, a.userId);
  }

  // --- Runs ---------------------------------------------------------------------------

  @RequireAccess('payroll', ['crud', 'approve']) @Get('runs')
  runs(@CurrentAuth() a: SchoolAuth) {
    return this.payroll.listRuns(a.schoolId);
  }

  @RequireAccess('payroll', ['crud']) @Post('runs')
  createRun(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateRunDto) {
    return this.payroll.createRun(a.schoolId, dto, a.userId);
  }

  @RequireAccess('payroll', ['crud', 'approve']) @Get('runs/:id')
  run(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.payroll.getRun(a.schoolId, id);
  }

  @RequireAccess('payroll', ['crud']) @Post('runs/:id/recalculate') @HttpCode(HttpStatus.OK)
  recalculate(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.payroll.recalculate(a.schoolId, id);
  }

  @RequireAccess('payroll', ['crud']) @Patch('items/:id')
  adjust(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: AdjustItemDto) {
    return this.payroll.adjustItem(a.schoolId, id, dto);
  }

  @RequireAccess('payroll', ['crud']) @Post('runs/:id/submit') @HttpCode(HttpStatus.OK)
  submit(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.payroll.submit(a.schoolId, id, a.userId);
  }

  @RequireAccess('payroll', ['approve']) @Post('runs/:id/approve') @HttpCode(HttpStatus.OK)
  approve(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.payroll.approve(a.schoolId, id, a.userId);
  }

  @RequireAccess('payroll', ['approve']) @Post('runs/:id/return') @HttpCode(HttpStatus.OK)
  returnToDraft(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: RunNoteDto) {
    return this.payroll.returnToDraft(a.schoolId, id, dto.note);
  }

  @RequireAccess('payroll', ['crud']) @Post('runs/:id/cancel') @HttpCode(HttpStatus.OK)
  cancel(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: RunNoteDto) {
    return this.payroll.cancel(a.schoolId, id, dto.note);
  }

  @RequireAccess('payroll', ['crud']) @Post('runs/:id/pay') @HttpCode(HttpStatus.OK)
  pay(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: PayRunDto) {
    return this.payroll.pay(a.schoolId, id, dto, a.userId);
  }

  // --- Payslips -----------------------------------------------------------------------

  /** Own payslips. Accounts and admin staff are employees too, so they can see theirs. */
  @RequireAccess('payroll', ['own', 'crud', 'approve']) @Get('payslips/me')
  mine(@CurrentAuth() a: SchoolAuth) {
    return this.payroll.myPayslips(a.schoolId, a.userId);
  }

  /** Register of every payslip issued (paid runs), for Accounts. */
  @RequireAccess('payroll', ['crud', 'approve']) @Get('payslips')
  register(@CurrentAuth() a: SchoolAuth, @Query('runId') runId?: string, @Query('q') q?: string) {
    return this.payroll.payslipRegister(a.schoolId, runId, q);
  }

  @RequireAccess('payroll', ['own', 'crud', 'approve']) @Get('payslips/:itemId')
  payslip(@CurrentAuth() a: SchoolAuth, @Param('itemId', Id()) itemId: string) {
    return this.payroll.payslip(a, itemId);
  }
}
