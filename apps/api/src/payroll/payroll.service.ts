import { accountSnapshot } from './bank-accounts.service.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasAccess } from '@schoolerp/shared';
import { formatDateOnly, toDateOnly } from '../common/date-only.js';
import { schoolClock } from '../common/school-time.js';
import { fromMinor, toMinor } from '../fees/money.js';
import type { PayrollRunStatus } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import { approverIds } from '../rbac/approvers.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import { calculatePay, netPay } from './engine.js';
import type { AdjustItemDto, CreateRunDto, PayRunDto, SalaryStructureDto } from './payroll.dto.js';

const EMPLOYEE_REF = { select: { id: true, employeeNo: true, firstName: true, lastName: true, designation: true, staffType: true, userId: true, photoKey: true } } as const;
const PAYABLE_STATUSES = ['active', 'on_leave'] as const;

/** Page 9: salary structures, payroll runs (draft → reviewed → approved → paid) and payslips. */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Salary structures ------------------------------------------------------------

  /** Current staff with their active salary structure (null when none is set yet). */
  async listStructures(schoolId: string) {
    const employees = await this.prisma.forSchool(schoolId).employee.findMany({
      where: { status: { in: [...PAYABLE_STATUSES] } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        ...EMPLOYEE_REF.select,
        joinDate: true,
        salaryStructures: { where: { isActive: true }, include: { components: { orderBy: [{ kind: 'asc' }, { name: 'asc' }] } } },
      },
    });
    return employees.map(({ salaryStructures, ...e }) => ({ ...e, structure: salaryStructures[0] ?? null }));
  }

  async structureHistory(schoolId: string, employeeId: string) {
    return this.prisma.forSchool(schoolId).salaryStructure.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
      include: { components: true },
    });
  }

  /** Saves a new version of an employee's salary structure; the previous one is kept as history. */
  setStructure(schoolId: string, employeeId: string, dto: SalaryStructureDto, actorUserId: string) {
    for (const c of dto.components) {
      if (c.calc === 'percent_of_basic' && Number(c.value) > 100) throw new BadRequestException(`${c.name}: a percentage cannot exceed 100`);
    }
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { status: true } });
      if (!employee) throw new NotFoundException('Employee not found');
      await tx.salaryStructure.updateMany({ where: { employeeId, isActive: true }, data: { isActive: false } });
      const structure = await tx.salaryStructure.create({
        data: { schoolId, employeeId, basicSalary: dto.basicSalary, effectiveFrom: toDateOnly(dto.effectiveFrom), createdBy: actorUserId },
      });
      if (dto.components.length) {
        await tx.salaryComponent.createMany({ data: dto.components.map((c) => ({ schoolId, structureId: structure.id, ...c })) });
      }
      return tx.salaryStructure.findUnique({ where: { id: structure.id }, include: { components: true } });
    });
  }

  // --- Runs ---------------------------------------------------------------------------

  listRuns(schoolId: string) {
    return this.prisma.forSchool(schoolId).payrollRun.findMany({
      orderBy: [{ period: { startDate: 'desc' } }, { createdAt: 'desc' }],
      include: { period: true, _count: { select: { items: true } } },
    });
  }

  async getRun(schoolId: string, id: string) {
    const run = await this.prisma.forSchool(schoolId).payrollRun.findUnique({
      where: { id },
      include: {
        period: true,
        items: {
          orderBy: { employee: { firstName: 'asc' } },
          include: { employee: EMPLOYEE_REF, deductions: true, payslip: true, payment: true },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  /** Creates the period (if new) and a draft run, then calculates every payable employee. */
  createRun(schoolId: string, dto: CreateRunDto, actorUserId: string) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('The end date cannot be before the start date');
    return this.prisma.inSchoolTransaction(
      schoolId,
      async (tx) => {
        await lock(tx, `payroll:${schoolId}`);
        const start = toDateOnly(dto.startDate);
        const end = toDateOnly(dto.endDate);
        const overlapping = await tx.payrollPeriod.findFirst({
          where: { startDate: { lte: end }, endDate: { gte: start }, NOT: { startDate: start, endDate: end }, runs: { some: { status: { not: 'cancelled' } } } },
        });
        if (overlapping) throw new ConflictException(`This period overlaps "${overlapping.name}", which already has a payroll run`);
        const period =
          (await tx.payrollPeriod.findUnique({ where: { schoolId_startDate_endDate: { schoolId, startDate: start, endDate: end } } })) ??
          (await tx.payrollPeriod.create({ data: { schoolId, name: dto.name, startDate: start, endDate: end } }));
        const live = await tx.payrollRun.findFirst({ where: { periodId: period.id, status: { not: 'cancelled' } } });
        if (live) throw new ConflictException('This period already has a payroll run; recalculate or cancel it instead');
        const run = await tx.payrollRun.create({
          data: { schoolId, periodId: period.id, applyAttendance: dto.applyAttendance ?? true, workingDays: 0, calculatedAt: new Date(), createdBy: actorUserId },
        });
        await calculateRun(tx, schoolId, run.id);
        return { id: run.id };
      },
      { timeout: 60_000 },
    );
  }

  /** Recomputes a draft run from current structures, attendance and leave. Manual adjustments are reset. */
  recalculate(schoolId: string, id: string) {
    return this.prisma.inSchoolTransaction(
      schoolId,
      async (tx) => {
        await assertStatus(tx, id, ['draft']);
        await calculateRun(tx, schoolId, id);
        return { id };
      },
      { timeout: 60_000 },
    );
  }

  /** Accounts' review adjustments on one employee: bonus, a manual deduction, a note. */
  adjustItem(schoolId: string, itemId: string, dto: AdjustItemDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const item = await tx.payrollItem.findUnique({ where: { id: itemId }, include: { deductions: true } });
      if (!item) throw new NotFoundException('Payroll item not found');
      await assertStatus(tx, item.runId, ['draft']);
      await tx.payrollDeduction.deleteMany({ where: { itemId, type: 'manual' } });
      const manual = toMinor(dto.manualDeduction);
      if (manual > 0) {
        await tx.payrollDeduction.create({ data: { schoolId, itemId, type: 'manual', label: dto.manualDeductionLabel || 'Other deduction', amount: fromMinor(manual) } });
      }
      const computed = item.deductions.filter((d) => d.type !== 'manual').reduce((s, d) => s + toMinor(d.amount), 0);
      const total = computed + manual;
      const bonus = toMinor(dto.bonus);
      const gross = toMinor(item.basic) + toMinor(item.allowances) + bonus;
      await tx.payrollItem.update({
        where: { id: itemId },
        data: {
          bonus: fromMinor(bonus),
          gross: fromMinor(gross),
          otherDeductions: fromMinor(toMinor(item.otherDeductions) - sumManual(item.deductions) + manual),
          totalDeductions: fromMinor(total),
          net: fromMinor(netPay(gross, 0, total)),
          note: dto.note ?? null,
        },
      });
      await updateTotals(tx, item.runId);
      return tx.payrollItem.findUnique({ where: { id: itemId }, include: { deductions: true } });
    });
  }

  /** draft → reviewed (Accounts Review); the principal and admins are asked to approve. */
  async submit(schoolId: string, id: string, actorUserId: string) {
    const run = await this.transition(schoolId, id, ['draft'], { status: 'reviewed', reviewedBy: actorUserId, reviewedAt: new Date() });
    await this.notifications.notify(schoolId, await approverIds(this.prisma, schoolId), { eventType: 'payroll_approval', title: 'Payroll waiting for approval', body: 'Accounts sent a payroll run for approval.', link: `/payroll/runs/${id}` });
    return run;
  }

  /** reviewed → approved (Admin Approval). */
  approve(schoolId: string, id: string, actorUserId: string) {
    return this.transition(schoolId, id, ['reviewed'], { status: 'approved', approvedBy: actorUserId, approvedAt: new Date() });
  }

  /** reviewed → draft, with the admin's reason. */
  returnToDraft(schoolId: string, id: string, note: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const run = await assertStatus(tx, id, ['reviewed']);
      return tx.payrollRun.update({ where: { id }, data: { status: 'draft', reviewedBy: null, reviewedAt: null, notes: appendNote(run.notes, `Returned: ${note}`) } });
    });
  }

  cancel(schoolId: string, id: string, note: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const run = await assertStatus(tx, id, ['draft', 'reviewed']);
      return tx.payrollRun.update({ where: { id }, data: { status: 'cancelled', notes: appendNote(run.notes, `Cancelled: ${note}`) } });
    });
  }

  /** approved → paid: records a payment per employee and generates payslips (Payment Processed → Payslip Generated). */
  async pay(schoolId: string, id: string, dto: PayRunDto, actorUserId: string) {
    const paid = await this.prisma.inSchoolTransaction(
      schoolId,
      async (tx) => {
        await lock(tx, `payroll:${schoolId}`);
        await assertStatus(tx, id, ['approved']);
        const run = await tx.payrollRun.findUniqueOrThrow({ where: { id }, include: { period: true, items: { select: { id: true, net: true, employeeId: true } } } });
        const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
        const prefix = `PSL-${formatDateOnly(run.period.endDate).slice(0, 7).replace('-', '')}-`;
        const existing = await tx.payslip.findMany({ where: { payslipNo: { startsWith: prefix } }, select: { payslipNo: true } });
        let next = existing.reduce((m, p) => Math.max(m, Number(p.payslipNo.slice(prefix.length)) || 0), 0);
        const accounts = await tx.employeeBankAccount.findMany({ where: { status: 'approved', employeeId: { in: run.items.map((i) => i.employeeId) } } });
        const byEmployee = new Map(accounts.map((a) => [a.employeeId, a]));
        for (const item of run.items) {
          // Bank transfers go to each person's approved account (recorded on the payment and payslip).
          const account = byEmployee.get(item.employeeId);
          await tx.payrollPayment.create({
            data: {
              schoolId, itemId: item.id, amount: item.net, method: dto.method, reference: dto.reference ?? null, paidAt, recordedBy: actorUserId,
              ...(account && { bankAccountId: account.id, payeeAccount: accountSnapshot(account) }),
            },
          });
          await tx.payslip.create({ data: { schoolId, itemId: item.id, payslipNo: `${prefix}${String(++next).padStart(4, '0')}` } });
        }
        return tx.payrollRun.update({ where: { id }, data: { status: 'paid', paidAt }, include: { period: { select: { name: true } } } });
      },
      { timeout: 60_000 },
    );
    // Page 11: "Payroll Approved → Staff" — sent when salaries are paid and payslips exist.
    const staff = await this.prisma.forSchool(schoolId).payrollItem.findMany({ where: { runId: id }, select: { employee: { select: { userId: true } } } });
    await this.notifications.notify(schoolId, staff.map((s) => s.employee.userId), { eventType: 'payroll_paid', title: `Salary paid · ${paid.period.name}`, body: 'Your payslip is ready.', link: '/payslips' });
    return paid;
  }

  // --- Payslips -----------------------------------------------------------------------

  /** Every payslip from paid runs (newest period first), optionally for one run or a name search. */
  payslipRegister(schoolId: string, runId?: string, q?: string) {
    return this.prisma.forSchool(schoolId).payrollItem.findMany({
      where: {
        run: { status: 'paid', ...(runId && { id: runId }) },
        ...(q && { employee: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { employeeNo: { contains: q, mode: 'insensitive' } }] } }),
      },
      orderBy: [{ run: { period: { startDate: 'desc' } } }, { employee: { firstName: 'asc' } }],
      take: 1000,
      select: {
        id: true, gross: true, totalDeductions: true, net: true,
        employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, designation: true, photoKey: true } },
        payslip: { select: { payslipNo: true } },
        payment: { select: { method: true, reference: true, paidAt: true, payeeAccount: true } },
        run: { select: { id: true, period: { select: { name: true, startDate: true } } } },
      },
    });
  }

  /** The signed-in employee's payslips from paid runs. */
  async myPayslips(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const employee = await db.employee.findUnique({ where: { userId }, select: { id: true } });
    if (!employee) return [];
    return db.payrollItem.findMany({
      where: { employeeId: employee.id, run: { status: 'paid' } },
      orderBy: { run: { period: { startDate: 'desc' } } },
      select: { id: true, gross: true, totalDeductions: true, net: true, payslip: true, run: { select: { period: true, paidAt: true } } },
    });
  }

  async payslip(auth: { schoolId: string; userId: string }, itemId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const item = await db.payrollItem.findUnique({
      where: { id: itemId },
      include: {
        employee: { select: { ...EMPLOYEE_REF.select, department: true, joinDate: true } },
        deductions: true,
        payslip: true,
        payment: true,
        run: { select: { status: true, period: true } },
      },
    });
    if (!item) throw new NotFoundException('Payslip not found');
    const perms = new Set((await this.permissions.loadUserAccess(auth.schoolId, auth.userId)).permissions);
    const isManager = hasAccess(perms, 'payroll', ['crud', 'approve']);
    if (!isManager && !(hasAccess(perms, 'payroll', ['own']) && item.employee.userId === auth.userId && item.run.status === 'paid')) {
      throw new ForbiddenException();
    }
    const [school, settings] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: auth.schoolId }, select: { name: true } }),
      db.schoolSettings.findUnique({ where: { schoolId: auth.schoolId }, select: { currency: true } }),
    ]);
    return { school: school?.name, currency: settings?.currency ?? 'USD', item };
  }

  async summary(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [withStructure, staff, lastPaid, pending] = await Promise.all([
      db.salaryStructure.count({ where: { isActive: true, employee: { status: { in: [...PAYABLE_STATUSES] } } } }),
      db.employee.count({ where: { status: { in: [...PAYABLE_STATUSES] } } }),
      db.payrollRun.findFirst({ where: { status: 'paid' }, orderBy: { paidAt: 'desc' }, include: { period: true } }),
      db.payrollRun.count({ where: { status: { in: ['draft', 'reviewed', 'approved'] } } }),
    ]);
    return { staff, withStructure, pendingRuns: pending, lastPaid };
  }

  private transition(schoolId: string, id: string, from: PayrollRunStatus[], data: { status: PayrollRunStatus; [k: string]: unknown }) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await assertStatus(tx, id, from);
      return tx.payrollRun.update({ where: { id }, data });
    });
  }
}

// --- Calculation ------------------------------------------------------------------------

async function calculateRun(tx: TenantTx, schoolId: string, runId: string): Promise<void> {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { period: true } });
  const settings = await tx.schoolSettings.findUnique({ where: { schoolId }, select: { timezone: true, weeklyOffDays: true } });
  const start = formatDateOnly(run.period.startDate);
  const end = formatDateOnly(run.period.endDate);
  const today = schoolClock(settings?.timezone ?? 'UTC').date;
  const offDays = settings?.weeklyOffDays ?? [7];

  const employees = await tx.employee.findMany({
    where: { status: { in: [...PAYABLE_STATUSES] }, joinDate: { lte: run.period.endDate }, salaryStructures: { some: { isActive: true } } },
    select: { id: true, joinDate: true, salaryStructures: { where: { isActive: true }, include: { components: true } } },
  });
  if (employees.length === 0) throw new BadRequestException('No current staff have a salary structure yet');

  const [attendance, leaves] = await Promise.all([
    tx.staffAttendance.findMany({
      where: { date: { gte: run.period.startDate, lte: run.period.endDate }, OR: [{ reviewStatus: null }, { reviewStatus: { not: 'rejected' } }] },
      select: { employeeId: true, date: true },
    }),
    tx.leaveRequest.findMany({
      where: { status: 'approved', startDate: { lte: run.period.endDate }, endDate: { gte: run.period.startDate } },
      select: { employeeId: true, startDate: true, endDate: true, leaveType: { select: { isPaid: true } } },
    }),
  ]);

  await tx.payrollItem.deleteMany({ where: { runId } });
  let workingDays = 0;
  for (const e of employees) {
    const structure = e.salaryStructures[0]!;
    const result = calculatePay({
      periodStart: start,
      periodEnd: end,
      today,
      offDays,
      applyAttendance: run.applyAttendance,
      joinDate: formatDateOnly(e.joinDate),
      basic: toMinor(structure.basicSalary),
      components: structure.components.map((c) => ({ kind: c.kind, name: c.name, calc: c.calc, value: toMinor(c.value) })),
      presentDates: new Set(attendance.filter((a) => a.employeeId === e.id).map((a) => formatDateOnly(a.date))),
      leaves: leaves
        .filter((l) => l.employeeId === e.id)
        .map((l) => ({ start: formatDateOnly(l.startDate), end: formatDateOnly(l.endDate), isPaid: l.leaveType.isPaid })),
    });
    workingDays = result.workingDays;
    const total = result.attendanceDeduction + result.leaveDeduction + result.otherDeductions;
    const item = await tx.payrollItem.create({
      data: {
        schoolId,
        runId,
        employeeId: e.id,
        basic: fromMinor(result.basic),
        allowances: fromMinor(result.allowances),
        gross: fromMinor(result.gross),
        attendanceDeduction: fromMinor(result.attendanceDeduction),
        leaveDeduction: fromMinor(result.leaveDeduction),
        otherDeductions: fromMinor(result.otherDeductions),
        totalDeductions: fromMinor(total),
        net: fromMinor(netPay(result.gross, 0, total)),
        workingDays: result.workingDays,
        payableDays: result.payableDays,
        presentDays: result.presentDays,
        paidLeaveDays: result.paidLeaveDays,
        unpaidLeaveDays: result.unpaidLeaveDays,
        absentDays: result.absentDays,
        earnings: result.earnings.map((x) => ({ name: x.name, amount: fromMinor(x.amount) })),
      },
    });
    if (result.deductions.length) {
      await tx.payrollDeduction.createMany({ data: result.deductions.map((d) => ({ schoolId, itemId: item.id, type: d.type, label: d.label, amount: fromMinor(d.amount) })) });
    }
  }
  await tx.payrollRun.update({ where: { id: runId }, data: { workingDays, calculatedAt: new Date() } });
  await updateTotals(tx, runId);
}

async function updateTotals(tx: TenantTx, runId: string): Promise<void> {
  const items = await tx.payrollItem.findMany({ where: { runId }, select: { gross: true, totalDeductions: true, net: true } });
  const sum = (k: 'gross' | 'totalDeductions' | 'net') => fromMinor(items.reduce((s, i) => s + toMinor(i[k]), 0));
  await tx.payrollRun.update({ where: { id: runId }, data: { totalGross: sum('gross'), totalDeductions: sum('totalDeductions'), totalNet: sum('net') } });
}

async function assertStatus(tx: TenantTx, id: string, allowed: PayrollRunStatus[]) {
  const run = await tx.payrollRun.findUnique({ where: { id } });
  if (!run) throw new NotFoundException('Payroll run not found');
  if (!allowed.includes(run.status)) throw new BadRequestException(`This action is not possible on a ${run.status} run`);
  return run;
}

async function lock(tx: TenantTx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function sumManual(deductions: { type: string; amount: { toString(): string } }[]): number {
  return deductions.filter((d) => d.type === 'manual').reduce((s, d) => s + toMinor(d.amount), 0);
}

function appendNote(existing: string | null, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}
