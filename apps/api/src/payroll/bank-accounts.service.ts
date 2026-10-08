import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NotificationsService } from '../communication/notifications.service.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class BankAccountDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) bankName: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) accountTitle: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value)) @Matches(/^[A-Za-z0-9-]{6,34}$/, { message: 'accountNumber must be 6–34 letters or digits' }) accountNumber: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() || null : value)) @Matches(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, { message: 'iban must look like PK36SCBL0000001123456702' }) iban?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) branch?: string | null;
  /** The reason, when asking to change an approved account. */
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) requestNote?: string | null;
}

export class ReviewBankAccountDto {
  @IsIn(['approved', 'rejected']) decision: 'approved' | 'rejected';
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) note?: string | null;
}

const EMPLOYEE = { select: { id: true, employeeNo: true, firstName: true, lastName: true, designation: true, userId: true } } as const;

/** "HBL · Areeba Siddiqui · ****6789" for payment records and payslips. */
export function accountSnapshot(a: { bankName: string; accountTitle: string; accountNumber: string; iban: string | null }): string {
  const tail = (a.iban ?? a.accountNumber).slice(-4);
  return `${a.bankName} · ${a.accountTitle} · ****${tail}`;
}

/**
 * Staff bank accounts for salary payments: the staff member submits (or asks to change) their
 * account with a note; Accounts approves or rejects. Exactly one approved account is used by payroll.
 */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async mine(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const employee = await db.employee.findUnique({ where: { userId }, select: { id: true } });
    if (!employee) return { current: null, pending: null, history: [] };
    const rows = await db.employeeBankAccount.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' }, take: 10 });
    return { current: rows.find((r) => r.status === 'approved') ?? null, pending: rows.find((r) => r.status === 'pending') ?? null, history: rows.filter((r) => r.status === 'rejected' || r.status === 'replaced') };
  }

  async submit(schoolId: string, userId: string, dto: BankAccountDto) {
    const created = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await tx.employee.findUnique({ where: { userId }, select: { id: true, firstName: true, lastName: true } });
      if (!employee) throw new NotFoundException('No staff record is linked to your account');
      if (await tx.employeeBankAccount.findFirst({ where: { employeeId: employee.id, status: 'pending' }, select: { id: true } })) {
        throw new ConflictException('You already have a request waiting for Accounts; cancel it first to send a new one');
      }
      const hasApproved = !!(await tx.employeeBankAccount.findFirst({ where: { employeeId: employee.id, status: 'approved' }, select: { id: true } }));
      if (hasApproved && !dto.requestNote) throw new BadRequestException('Explain why the account should change (e.g. “Closed my old account”)');
      const row = await tx.employeeBankAccount.create({
        data: { schoolId, employeeId: employee.id, bankName: dto.bankName, accountTitle: dto.accountTitle, accountNumber: dto.accountNumber, iban: dto.iban ?? null, branch: dto.branch ?? null, requestNote: dto.requestNote ?? null, submittedBy: userId },
      });
      return { row, employee, isChange: hasApproved };
    });
    const finance = await this.prisma.forSchool(schoolId).user.findMany({ where: { status: 'active', userRoles: { some: { role: { key: 'accounts' } } } }, select: { id: true } });
    await this.notifications.notify(schoolId, finance.map((u) => u.id), {
      eventType: 'bank_account_request',
      title: `${created.isChange ? 'Bank account change' : 'New bank account'} · ${created.employee.firstName} ${created.employee.lastName}`,
      body: created.row.requestNote ?? `${created.row.bankName} · ${created.row.accountTitle}`,
      link: '/staff-payroll?tab=bank',
    });
    return created.row;
  }

  async cancelMine(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const employee = await db.employee.findUnique({ where: { userId }, select: { id: true } });
    if (!employee) throw new NotFoundException('No staff record is linked to your account');
    const { count } = await db.employeeBankAccount.deleteMany({ where: { employeeId: employee.id, status: 'pending' } });
    if (!count) throw new NotFoundException('No pending request');
  }

  list(schoolId: string, status?: string) {
    return this.prisma.forSchool(schoolId).employeeBankAccount.findMany({
      where: status ? { status: status as never } : { status: { in: ['pending', 'approved'] } },
      include: { employee: EMPLOYEE },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  async review(schoolId: string, actorId: string, id: string, dto: ReviewBankAccountDto) {
    const row = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const r = await tx.employeeBankAccount.findUnique({ where: { id }, include: { employee: EMPLOYEE } });
      if (!r) throw new NotFoundException('Request not found');
      if (r.status !== 'pending') throw new BadRequestException('This request has already been reviewed');
      if (dto.decision === 'rejected' && !dto.note) throw new BadRequestException('Give a reason for rejecting');
      if (dto.decision === 'approved') await this.replaceApproved(tx, r.employeeId);
      return tx.employeeBankAccount.update({ where: { id }, data: { status: dto.decision, reviewNote: dto.note ?? null, reviewedBy: actorId, reviewedAt: new Date() }, include: { employee: EMPLOYEE } });
    });
    await this.notifications.notify(schoolId, [row.employee.userId], {
      eventType: 'bank_account_reviewed',
      title: `Bank account ${dto.decision}`,
      body: dto.note ?? (dto.decision === 'approved' ? 'Your salary will be paid to this account.' : null),
      link: '/salary-payslips',
    });
    return row;
  }

  /** Accounts enters or corrects an account directly (it is approved at once). */
  async setForEmployee(schoolId: string, actorId: string, employeeId: string, dto: BankAccountDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      if (!(await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundException('Staff member not found');
      await tx.employeeBankAccount.deleteMany({ where: { employeeId, status: 'pending' } });
      await this.replaceApproved(tx, employeeId);
      return tx.employeeBankAccount.create({
        data: { schoolId, employeeId, bankName: dto.bankName, accountTitle: dto.accountTitle, accountNumber: dto.accountNumber, iban: dto.iban ?? null, branch: dto.branch ?? null, requestNote: dto.requestNote ?? null, status: 'approved', submittedBy: actorId, reviewedBy: actorId, reviewedAt: new Date() },
        include: { employee: EMPLOYEE },
      });
    });
  }

  private async replaceApproved(tx: TenantTx, employeeId: string) {
    await tx.employeeBankAccount.updateMany({ where: { employeeId, status: 'approved' }, data: { status: 'replaced' } });
  }
}
