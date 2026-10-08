import { NotificationsService } from '../communication/notifications.service.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatDateOnly, toDateOnly } from '../common/date-only.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type { ApplyLeaveDto, DecideLeaveDto, LeaveListQuery, LeaveTypeDto } from './attendance.dto.js';
import { workingDays } from './geo.js';

const REQUEST_INCLUDE = {
  leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
  employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, designation: true } },
} as const;

/** Leave types, requests, balances and approval (Leave row: Admin Approve, Accounts View, staff Own). */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Users who decide leave (School Admins). */
  private async approvers(schoolId: string): Promise<string[]> {
    const rows = await this.prisma.forSchool(schoolId).user.findMany({ where: { status: 'active', userRoles: { some: { role: { key: 'school_admin' } } } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  // --- Types ----------------------------------------------------------------------

  listTypes(schoolId: string) {
    return this.prisma.forSchool(schoolId).leaveType.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  createType(schoolId: string, dto: LeaveTypeDto) {
    return this.prisma.forSchool(schoolId).leaveType.create({ data: { schoolId, ...dto } });
  }

  async updateType(schoolId: string, id: string, dto: LeaveTypeDto) {
    const db = this.prisma.forSchool(schoolId);
    if (!(await db.leaveType.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Leave type not found');
    return db.leaveType.update({ where: { id }, data: dto });
  }

  // --- Own requests ------------------------------------------------------------------

  async mine(schoolId: string, userId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await ownEmployee(tx, userId);
      const year = new Date().getUTCFullYear();
      const [requests, balances] = await Promise.all([
        tx.leaveRequest.findMany({ where: { employeeId: employee.id }, orderBy: { startDate: 'desc' }, take: 100, include: REQUEST_INCLUDE }),
        balancesFor(tx, employee.id, year),
      ]);
      return { year, balances, requests };
    });
  }

  async apply(schoolId: string, userId: string, dto: ApplyLeaveDto) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('The leave must end on or after its start date');
    if (dto.startDate.slice(0, 4) !== dto.endDate.slice(0, 4)) throw new BadRequestException('Split leave that crosses into a new year into two requests');
    const created = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await ownEmployee(tx, userId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'leave:' + employee.id}, 0))`;
      const type = await tx.leaveType.findUnique({ where: { id: dto.leaveTypeId } });
      if (!type || !type.isActive) throw new BadRequestException('Choose an active leave type');

      const settings = await tx.schoolSettings.findUnique({ where: { schoolId }, select: { weeklyOffDays: true } });
      const days = workingDays(dto.startDate, dto.endDate, settings?.weeklyOffDays ?? [7]);
      if (days === 0) throw new BadRequestException('The selected dates are all weekly off-days');

      const overlap = await tx.leaveRequest.findFirst({
        where: { employeeId: employee.id, status: { in: ['pending', 'approved'] }, startDate: { lte: toDateOnly(dto.endDate) }, endDate: { gte: toDateOnly(dto.startDate) } },
      });
      if (overlap) throw new ConflictException(`You already have leave from ${formatDateOnly(overlap.startDate)} to ${formatDateOnly(overlap.endDate)}`);
      await assertQuota(tx, employee.id, type, Number(dto.startDate.slice(0, 4)), days);

      return tx.leaveRequest.create({
        data: { schoolId, employeeId: employee.id, leaveTypeId: type.id, startDate: toDateOnly(dto.startDate), endDate: toDateOnly(dto.endDate), days, reason: dto.reason },
        include: REQUEST_INCLUDE,
      });
    });
    await this.notifications.notify(schoolId, await this.approvers(schoolId), {
      eventType: 'leave_requested',
      title: `Leave request · ${created.employee.firstName} ${created.employee.lastName}`,
      body: `${created.leaveType.name}, ${formatDateOnly(created.startDate)} – ${formatDateOnly(created.endDate)} (${created.days} day${created.days === 1 ? '' : 's'})`,
      link: '/attendance',
    });
    return created;
  }

  cancel(schoolId: string, userId: string, id: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await ownEmployee(tx, userId);
      const request = await tx.leaveRequest.findUnique({ where: { id } });
      if (!request || request.employeeId !== employee.id) throw new NotFoundException('Leave request not found');
      if (request.status !== 'pending') throw new BadRequestException('Only pending requests can be cancelled');
      return tx.leaveRequest.update({ where: { id }, data: { status: 'cancelled' }, include: REQUEST_INCLUDE });
    });
  }

  // --- Approvals ---------------------------------------------------------------------

  list(schoolId: string, q: LeaveListQuery) {
    return this.prisma.forSchool(schoolId).leaveRequest.findMany({
      where: { status: q.status },
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
      take: 300,
      include: REQUEST_INCLUDE,
    });
  }

  async decide(schoolId: string, id: string, dto: DecideLeaveDto, actorUserId: string) {
    const decided = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const request = await tx.leaveRequest.findUnique({ where: { id }, include: { leaveType: true, employee: { select: { userId: true } } } });
      if (!request) throw new NotFoundException('Leave request not found');
      if (request.status !== 'pending') throw new BadRequestException('This request has already been decided');
      if (request.employee.userId === actorUserId) throw new ForbiddenException('You cannot approve your own leave');
      if (dto.decision === 'approved') {
        await assertQuota(tx, request.employeeId, request.leaveType, request.startDate.getUTCFullYear(), 0, id);
      }
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: { status: dto.decision, decidedBy: actorUserId, decidedAt: new Date(), decisionNote: dto.note ?? null },
        include: REQUEST_INCLUDE,
      });
      return { updated, userId: request.employee.userId, typeName: request.leaveType.name };
    });
    const r = decided.updated;
    await this.notifications.notify(schoolId, [decided.userId], {
      eventType: dto.decision === 'approved' ? 'leave_approved' : 'leave_rejected',
      title: `Leave ${dto.decision} · ${decided.typeName}`,
      body: `${formatDateOnly(r.startDate)} – ${formatDateOnly(r.endDate)}${dto.note ? ` · ${dto.note}` : ''}`,
      link: '/leave',
    });
    return r;
  }
}

async function ownEmployee(tx: TenantTx, userId: string) {
  const employee = await tx.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!employee) throw new NotFoundException('No staff record is linked to your account');
  return employee;
}

/** Per type: quota, approved (used) and pending days in a calendar year. */
async function balancesFor(tx: TenantTx, employeeId: string, year: number) {
  const types = await tx.leaveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  const rows = await tx.leaveRequest.groupBy({
    by: ['leaveTypeId', 'status'],
    where: { employeeId, status: { in: ['pending', 'approved'] }, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
    _sum: { days: true },
  });
  return types.map((t) => {
    const used = rows.find((r) => r.leaveTypeId === t.id && r.status === 'approved')?._sum.days ?? 0;
    const pending = rows.find((r) => r.leaveTypeId === t.id && r.status === 'pending')?._sum.days ?? 0;
    return { leaveTypeId: t.id, name: t.name, code: t.code, isPaid: t.isPaid, quota: t.annualQuota, used, pending, remaining: t.annualQuota === null ? null : t.annualQuota - used - pending };
  });
}

/**
 * The year's approved + pending days (excluding `ignoreId`) plus `extraDays` must fit the quota.
 * Applying counts pending requests so the quota cannot be oversubscribed.
 */
async function assertQuota(tx: TenantTx, employeeId: string, type: { id: string; name: string; annualQuota: number | null }, year: number, extraDays: number, ignoreId?: string) {
  if (type.annualQuota === null) return;
  const sum = await tx.leaveRequest.aggregate({
    where: {
      employeeId,
      leaveTypeId: type.id,
      status: { in: ['pending', 'approved'] },
      startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      ...(ignoreId && { NOT: { id: ignoreId } }),
    },
    _sum: { days: true },
  });
  const booked = sum._sum.days ?? 0;
  const thisRequest = ignoreId ? (await tx.leaveRequest.findUnique({ where: { id: ignoreId }, select: { days: true } }))!.days : extraDays;
  if (booked + thisRequest > type.annualQuota) {
    throw new BadRequestException(`${type.name}: ${type.annualQuota - booked} day(s) left this year, ${thisRequest} requested`);
  }
}
