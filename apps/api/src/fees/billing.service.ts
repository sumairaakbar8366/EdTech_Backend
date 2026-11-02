import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasAccess } from '@schoolerp/shared';
import { formatDateOnly, toDateOnly } from '../common/date-only.js';
import { schoolClock } from '../common/school-time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import type { GenerateInvoicesDto, InvoiceListQuery, PaymentDto, PaymentListQuery } from './fees.dto.js';
import { allocateOldestFirst, applyConcessions, deriveStatus, fromMinor, toMinor } from './money.js';

const OPEN = ['pending', 'partial', 'overdue'] as const;
const FREQUENCY_LABEL = { one_time: 'One-time', monthly: 'Monthly', termly: 'Termly', annual: 'Annual' } as const;
const STUDENT_REF = { select: { id: true, firstName: true, lastName: true, admissionNo: true } } as const;

/** Page 8: invoice generation, payments, allocations, receipts and statements. */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Invoices -------------------------------------------------------------------------

  /** Bulk-generates invoices for a class (page 8: structure → assignment → invoice → concessions → due date). */
  generate(schoolId: string, dto: GenerateInvoicesDto, actorUserId: string) {
    if (dto.dueDate < dto.issueDate) throw new BadRequestException('The due date cannot be before the issue date');
    return this.prisma.inSchoolTransaction(
      schoolId,
      async (tx) => {
        const yearId = await resolveYear(tx, dto.academicYearId);
        await lock(tx, `invoices:${schoolId}`);
        const assignments = await tx.studentFeeAssignment.findMany({
          where: {
            structure: { academicYearId: yearId, classId: dto.classId, isActive: true },
            student: {
              status: 'active',
              enrollments: { some: { academicYearId: yearId, status: 'enrolled', ...(dto.sectionId && { sectionId: dto.sectionId }) } },
            },
          },
          include: { structure: { include: { items: { where: { frequency: { in: dto.frequencies } }, include: { category: true } } } } },
        });
        if (assignments.length === 0) throw new BadRequestException('No students in this class have a fee structure assigned');

        const issue = toDateOnly(dto.issueDate);
        let created = 0;
        let skipped = 0;
        let nextNo = await nextNumber(tx, 'INV', dto.issueDate.slice(0, 4));
        const byStudent = new Map<string, typeof assignments>();
        for (const a of assignments) byStudent.set(a.studentId, [...(byStudent.get(a.studentId) ?? []), a]);

        for (const [studentId, list] of byStudent) {
          const exists = await tx.invoice.findUnique({ where: { studentId_academicYearId_periodLabel: { studentId, academicYearId: yearId, periodLabel: dto.periodLabel } }, select: { id: true } });
          const lines = list.flatMap((a) => a.structure.items).map((i, idx) => ({ key: String(idx), categoryId: i.categoryId, amount: toMinor(i.amount), description: `${i.category.name} (${FREQUENCY_LABEL[i.frequency]})` }));
          if (exists || lines.length === 0) {
            skipped++;
            continue;
          }
          const awards = await tx.scholarshipAward.findMany({
            where: { studentId, academicYearId: yearId, status: 'active', validFrom: { lte: issue }, validUntil: { gte: issue }, discount: { isActive: true } },
            include: { discount: true },
          });
          const discounts = applyConcessions(
            lines,
            awards.map((w) => ({ valueType: w.discount.valueType, value: toMinor(w.discount.value), categoryId: w.discount.categoryId })),
          );
          const subtotal = lines.reduce((s, l) => s + l.amount, 0);
          const discountTotal = lines.reduce((s, l) => s + discounts.get(l.key)!, 0);
          const invoice = await tx.invoice.create({
            data: {
              schoolId,
              invoiceNo: nextNo.value(),
              studentId,
              academicYearId: yearId,
              periodLabel: dto.periodLabel,
              issueDate: issue,
              dueDate: toDateOnly(dto.dueDate),
              subtotal: fromMinor(subtotal),
              discountTotal: fromMinor(discountTotal),
              total: fromMinor(subtotal - discountTotal),
              status: subtotal - discountTotal === 0 ? 'paid' : 'pending',
              createdBy: actorUserId,
            },
          });
          // Separate insert: a nested create cannot also set the item's own school_id.
          await tx.invoiceItem.createMany({
            data: lines.map((l) => ({
              schoolId,
              invoiceId: invoice.id,
              categoryId: l.categoryId,
              description: l.description,
              amount: fromMinor(l.amount),
              discount: fromMinor(discounts.get(l.key)!),
              net: fromMinor(l.amount - discounts.get(l.key)!),
            })),
          });
          nextNo = nextNo.next();
          created++;
        }
        return { created, skipped };
      },
      { timeout: 60_000 },
    );
  }

  async listInvoices(schoolId: string, q: InvoiceListQuery) {
    await this.refreshOverdue(schoolId);
    const db = this.prisma.forSchool(schoolId);
    const where: Prisma.InvoiceWhereInput = {
      status: q.status as Prisma.InvoiceWhereInput['status'],
      studentId: q.studentId,
      ...(q.classId && { student: { enrollments: { some: { section: { classId: q.classId }, academicYear: { isCurrent: true } } } } }),
      ...(q.q && {
        OR: [
          { invoiceNo: { contains: q.q, mode: 'insensitive' } },
          { periodLabel: { contains: q.q, mode: 'insensitive' } },
          { student: { OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }, { admissionNo: { contains: q.q, mode: 'insensitive' } }] } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      db.invoice.findMany({ where, include: { student: STUDENT_REF }, orderBy: [{ dueDate: 'desc' }, { invoiceNo: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      db.invoice.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async getInvoice(auth: { schoolId: string; userId: string }, id: string) {
    const invoice = await this.prisma.forSchool(auth.schoolId).invoice.findUnique({
      where: { id },
      include: {
        student: STUDENT_REF,
        academicYear: { select: { name: true } },
        items: { include: { category: { select: { name: true, code: true } } } },
        allocations: { include: { payment: { include: { receipt: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.assertCanSeeStudent(auth, invoice.studentId);
    return invoice;
  }

  waive(schoolId: string, id: string, note: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (!OPEN.includes(inv.status as (typeof OPEN)[number])) throw new BadRequestException(`A ${inv.status} invoice cannot be waived`);
      return tx.invoice.update({ where: { id }, data: { status: 'waived', notes: appendNote(inv.notes, `Waived: ${note}`) } });
    });
  }

  cancel(schoolId: string, id: string, note: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id } });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (toMinor(inv.amountPaid) > 0) throw new BadRequestException('An invoice with payments cannot be cancelled; void the payments first');
      if (inv.status === 'cancelled' || inv.status === 'waived') throw new BadRequestException(`This invoice is already ${inv.status}`);
      return tx.invoice.update({ where: { id }, data: { status: 'cancelled', notes: appendNote(inv.notes, `Cancelled: ${note}`) } });
    });
  }

  // --- Payments -------------------------------------------------------------------------

  /** Records a payment, allocates it (explicitly or oldest-first) and issues a receipt. */
  async recordPayment(schoolId: string, dto: PaymentDto, actorUserId: string) {
    const result = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id: dto.studentId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      await lock(tx, `payments:${dto.studentId}`);
      const amount = toMinor(dto.amount);
      if (amount <= 0) throw new BadRequestException('The amount must be greater than zero');

      const open = await tx.invoice.findMany({ where: { studentId: dto.studentId, status: { in: [...OPEN] } }, orderBy: [{ dueDate: 'asc' }, { invoiceNo: 'asc' }] });
      const balance = new Map(open.map((i) => [i.id, toMinor(i.total) - toMinor(i.amountPaid)]));
      let plan: [string, number][];
      if (dto.allocations) {
        plan = dto.allocations.map((a) => [a.invoiceId, toMinor(a.amount)]);
        if (new Set(plan.map(([k]) => k)).size !== plan.length) throw new BadRequestException('Each invoice can appear once');
        for (const [id, amt] of plan) {
          if (!balance.has(id)) throw new BadRequestException('Allocations must be to this student’s open invoices');
          if (amt > balance.get(id)!) throw new BadRequestException('An allocation exceeds the invoice balance');
        }
        if (plan.reduce((s, [, a]) => s + a, 0) !== amount) throw new BadRequestException('Allocations must add up to the payment amount');
      } else {
        const outstanding = [...balance.values()].reduce((s, b) => s + b, 0);
        if (amount > outstanding) throw new BadRequestException(`The amount exceeds the outstanding balance of ${fromMinor(outstanding)}`);
        plan = allocateOldestFirst(amount, open.map((i) => ({ key: i.id, balance: balance.get(i.id)! })));
      }

      const today = await todayFor(tx, schoolId);
      const payment = await tx.payment.create({
        data: {
          schoolId,
          studentId: dto.studentId,
          amount: fromMinor(amount),
          method: dto.method,
          reference: dto.reference ?? null,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          receivedBy: actorUserId,
          notes: dto.notes ?? null,
        },
      });
      for (const [invoiceId, amt] of plan) {
        await tx.paymentAllocation.create({ data: { schoolId, paymentId: payment.id, invoiceId, amount: fromMinor(amt) } });
        const inv = open.find((i) => i.id === invoiceId)!;
        const paid = toMinor(inv.amountPaid) + amt;
        await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: fromMinor(paid), status: deriveStatus(toMinor(inv.total), paid, formatDateOnly(inv.dueDate), today) } });
      }
      const receiptNo = (await nextNumber(tx, 'RCP', today.slice(0, 4))).value();
      const receipt = await tx.receipt.create({ data: { schoolId, receiptNo, paymentId: payment.id } });
      return { paymentId: payment.id, receiptNo: receipt.receiptNo, allocated: plan.map(([invoiceId, amt]) => ({ invoiceId, amount: fromMinor(amt) })), amount: fromMinor(amount) };
    });
    // Page 11: "Fee Paid → Parent (in-app + receipt)".
    await this.notifications.notifyStudents(schoolId, [dto.studentId], { students: true, guardians: true }, {
      eventType: 'fee_paid',
      title: `Payment received · receipt ${result.receiptNo}`,
      body: `A payment of ${result.amount} has been recorded.`,
      link: '/fees',
    });
    return result;
  }

  /** Voids a payment: removes its effect from every invoice it paid. */
  voidPayment(schoolId: string, id: string, reason: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id }, include: { allocations: { include: { invoice: true } } } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status === 'voided') throw new BadRequestException('This payment is already voided');
      await lock(tx, `payments:${payment.studentId}`);
      const today = await todayFor(tx, schoolId);
      for (const a of payment.allocations) {
        const inv = a.invoice;
        if (inv.status === 'cancelled' || inv.status === 'waived') continue;
        const paid = toMinor(inv.amountPaid) - toMinor(a.amount);
        await tx.invoice.update({ where: { id: inv.id }, data: { amountPaid: fromMinor(paid), status: deriveStatus(toMinor(inv.total), paid, formatDateOnly(inv.dueDate), today) } });
      }
      return tx.payment.update({ where: { id }, data: { status: 'voided', voidReason: reason, voidedAt: new Date() } });
    });
  }

  async listPayments(schoolId: string, q: PaymentListQuery) {
    const db = this.prisma.forSchool(schoolId);
    const where: Prisma.PaymentWhereInput = {
      studentId: q.studentId,
      ...((q.from || q.to) && { paidAt: { ...(q.from && { gte: toDateOnly(q.from) }), ...(q.to && { lt: new Date(toDateOnly(q.to).getTime() + 86_400_000) }) } }),
      ...(q.q && {
        OR: [
          { reference: { contains: q.q, mode: 'insensitive' } },
          { receipt: { receiptNo: { contains: q.q, mode: 'insensitive' } } },
          { student: { OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }, { admissionNo: { contains: q.q, mode: 'insensitive' } }] } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      db.payment.findMany({ where, include: { student: STUDENT_REF, receipt: true, allocations: { include: { invoice: { select: { invoiceNo: true, periodLabel: true } } } } }, orderBy: { paidAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      db.payment.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async receipt(auth: { schoolId: string; userId: string }, paymentId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      include: {
        receipt: true,
        student: { select: { ...STUDENT_REF.select, enrollments: { where: { academicYear: { isCurrent: true } }, select: { section: { select: { name: true, schoolClass: { select: { name: true } } } } } } } },
        allocations: { include: { invoice: { select: { invoiceNo: true, periodLabel: true, total: true, amountPaid: true } } } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.assertCanSeeStudent(auth, payment.studentId);
    const school = await this.prisma.school.findUnique({ where: { id: auth.schoolId }, select: { name: true } });
    const settings = await db.schoolSettings.findUnique({ where: { schoolId: auth.schoolId }, select: { currency: true } });
    return { school: school?.name, currency: settings?.currency ?? 'USD', payment };
  }

  // --- Statements & dashboard -------------------------------------------------------------

  /** A student's invoices, payments and balance (staff with fee access, the student, or a parent). */
  async statement(auth: { schoolId: string; userId: string }, studentId: string) {
    await this.assertCanSeeStudent(auth, studentId);
    await this.refreshOverdue(auth.schoolId);
    const db = this.prisma.forSchool(auth.schoolId);
    const [student, invoices, payments, awards] = await Promise.all([
      db.student.findUnique({ where: { id: studentId }, select: STUDENT_REF.select }),
      db.invoice.findMany({ where: { studentId }, orderBy: { dueDate: 'desc' }, include: { items: true } }),
      db.payment.findMany({ where: { studentId }, orderBy: { paidAt: 'desc' }, include: { receipt: true } }),
      db.scholarshipAward.findMany({ where: { studentId, status: 'active' }, include: { discount: { select: { name: true, kind: true, valueType: true, value: true } } } }),
    ]);
    const live = invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'waived');
    const billed = live.reduce((s, i) => s + toMinor(i.total), 0);
    const paid = live.reduce((s, i) => s + toMinor(i.amountPaid), 0);
    return {
      student,
      totals: { billed: fromMinor(billed), paid: fromMinor(paid), balance: fromMinor(billed - paid), overdue: invoices.filter((i) => i.status === 'overdue').length },
      invoices,
      payments,
      awards,
    };
  }

  async summary(schoolId: string) {
    await this.refreshOverdue(schoolId);
    const db = this.prisma.forSchool(schoolId);
    const today = await this.prisma.inSchoolTransaction(schoolId, (tx) => todayFor(tx, schoolId));
    const monthStart = toDateOnly(`${today.slice(0, 7)}-01`);
    const [open, overdueCount, monthPayments, byStatus] = await Promise.all([
      db.invoice.findMany({ where: { status: { in: [...OPEN] } }, select: { total: true, amountPaid: true } }),
      db.invoice.count({ where: { status: 'overdue' } }),
      db.payment.findMany({ where: { status: 'completed', paidAt: { gte: monthStart } }, select: { amount: true } }),
      db.invoice.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const settings = await db.schoolSettings.findUnique({ where: { schoolId }, select: { currency: true } });
    return {
      currency: settings?.currency ?? 'USD',
      outstanding: fromMinor(open.reduce((s, i) => s + toMinor(i.total) - toMinor(i.amountPaid), 0)),
      overdueInvoices: overdueCount,
      collectedThisMonth: fromMinor(monthPayments.reduce((s, p) => s + toMinor(p.amount), 0)),
      byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
    };
  }

  /** The signed-in student's id, or the parent's children ids. */
  async ownStudents(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const self = await db.student.findUnique({ where: { userId }, select: { id: true, firstName: true, lastName: true } });
    if (self) return [self];
    const links = await db.studentGuardian.findMany({ where: { guardian: { userId } }, select: { student: { select: { id: true, firstName: true, lastName: true } } } });
    return links.map((l) => l.student);
  }

  /** Marks open invoices past their due date as overdue (school-local date). */
  async refreshOverdue(schoolId: string) {
    await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const today = await todayFor(tx, schoolId);
      await tx.invoice.updateMany({ where: { status: { in: ['pending', 'partial'] }, dueDate: { lt: toDateOnly(today) } }, data: { status: 'overdue' } });
    });
  }

  private async assertCanSeeStudent(auth: { schoolId: string; userId: string }, studentId: string) {
    const perms = new Set((await this.permissions.loadUserAccess(auth.schoolId, auth.userId)).permissions);
    if (hasAccess(perms, 'fees', ['crud', 'view'])) return;
    const db = this.prisma.forSchool(auth.schoolId);
    const s = await db.student.findUnique({ where: { id: studentId }, select: { userId: true, guardians: { select: { guardian: { select: { userId: true } } } } } });
    if (!s) throw new NotFoundException('Student not found');
    if (hasAccess(perms, 'fees', ['own']) && s.userId === auth.userId) return;
    if (hasAccess(perms, 'fees', ['children']) && s.guardians.some((g) => g.guardian.userId === auth.userId)) return;
    throw new ForbiddenException();
  }
}

// --- helpers ---------------------------------------------------------------------------

async function lock(tx: TenantTx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function resolveYear(tx: TenantTx, academicYearId?: string): Promise<string> {
  const year = academicYearId
    ? await tx.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true } })
    : await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!year) throw new BadRequestException(academicYearId ? 'Academic year not found' : 'Set a current academic year first');
  return year.id;
}

async function todayFor(tx: TenantTx, schoolId: string): Promise<string> {
  const s = await tx.schoolSettings.findUnique({ where: { schoolId }, select: { timezone: true } });
  return schoolClock(s?.timezone ?? 'UTC').date;
}

/** Sequential document numbers per school and year: INV-2026-00001, RCP-2026-00001. */
async function nextNumber(tx: TenantTx, prefix: 'INV' | 'RCP', year: string) {
  await lock(tx, `${prefix}-seq`);
  const start = `${prefix}-${year}-`;
  const rows =
    prefix === 'INV'
      ? await tx.invoice.findMany({ where: { invoiceNo: { startsWith: start } }, select: { invoiceNo: true } })
      : await tx.receipt.findMany({ where: { receiptNo: { startsWith: start } }, select: { receiptNo: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(('invoiceNo' in r ? r.invoiceNo : r.receiptNo).slice(start.length)) || 0), 0);
  const make = (n: number) => ({ value: () => `${start}${String(n).padStart(5, '0')}`, next: () => make(n + 1) });
  return make(max + 1);
}

function appendNote(existing: string | null, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}
