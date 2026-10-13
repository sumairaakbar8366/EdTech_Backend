import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountsService, handover } from '../accounts/accounts.service.js';
import { toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type {
  ChangeStatusDto,
  CreateEmployeeDto,
  EmployeeProfileDto,
  ExperienceDto,
  ListEmployeesQuery,
  QualificationDto,
  StaffLoginDto,
  TeacherProfileDto,
  UpdateEmployeeDto,
} from './staff.dto.js';

const LIVE_SUBSCRIPTION = ['trialing', 'active', 'past_due'] as const;
/** Staff that count against the plan limit and may hold a working login. */
const EMPLOYED = ['active', 'on_leave'] as const;

const LIST_SELECT = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  staffType: true,
  designation: true,
  department: true,
  employmentType: true,
  joinDate: true,
  status: true,
  userId: true,
  campus: { select: { id: true, name: true, code: true } },
} satisfies Prisma.EmployeeSelect;

/**
 * Staff records (page 6 "Teacher Lifecycle": profile, qualifications, experience, status).
 * A staff member may optionally have a login with one or more staff roles.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  async list(schoolId: string, q: ListEmployeesQuery) {
    const where: Prisma.EmployeeWhereInput = {
      staffType: q.staffType,
      status: q.status,
      campusId: q.campusId,
      ...(q.q && {
        OR: [
          { firstName: { contains: q.q, mode: 'insensitive' } },
          { lastName: { contains: q.q, mode: 'insensitive' } },
          { employeeNo: { contains: q.q, mode: 'insensitive' } },
          { email: { contains: q.q, mode: 'insensitive' } },
          { designation: { contains: q.q, mode: 'insensitive' } },
        ],
      }),
    };
    const db = this.prisma.forSchool(schoolId);
    const [items, total] = await Promise.all([
      db.employee.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ status: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.employee.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async summary(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [teaching, nonTeaching, onLeave, withLogin] = await Promise.all([
      db.employee.count({ where: { staffType: 'teaching', status: { in: [...EMPLOYED] } } }),
      db.employee.count({ where: { staffType: 'non_teaching', status: { in: [...EMPLOYED] } } }),
      db.employee.count({ where: { status: 'on_leave' } }),
      db.employee.count({ where: { userId: { not: null }, status: { in: [...EMPLOYED] } } }),
    ]);
    return { teaching, nonTeaching, onLeave, withLogin, total: teaching + nonTeaching };
  }

  async get(schoolId: string, id: string) {
    const employee = await this.prisma.forSchool(schoolId).employee.findUnique({
      where: { id },
      include: {
        campus: { select: { id: true, name: true, code: true } },
        profile: true,
        teacherProfile: true,
        qualifications: { orderBy: { yearCompleted: 'desc' } },
        experiences: { orderBy: { startDate: 'desc' } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
        teacherAssignments: {
          include: {
            academicYear: { select: { id: true, name: true, isCurrent: true } },
            subject: { select: { id: true, name: true, code: true } },
            section: { select: { id: true, name: true, schoolClass: { select: { name: true, level: true } }, campus: { select: { code: true } } } },
          },
          orderBy: [{ academicYear: { startDate: 'desc' } }],
        },
        user: { select: { id: true, email: true, status: true, lastLoginAt: true, userRoles: { select: { role: { select: { key: true, name: true } } } } } },
      },
    });
    if (!employee) throw new NotFoundException('Staff member not found');
    return employee;
  }

  /** The signed-in user's own staff record ("own" access). */
  async getOwn(schoolId: string, userId: string) {
    const own = await this.prisma.forSchool(schoolId).employee.findUnique({ where: { userId }, select: { id: true } });
    if (!own) throw new NotFoundException('No staff record is linked to your account');
    return this.get(schoolId, own.id);
  }

  create(schoolId: string, dto: CreateEmployeeDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(schoolId, (tx) => this.createInTx(tx, schoolId, dto, actorUserId));
  }

  /** Creates an employee inside an existing school transaction (also used when hiring). */
  async createInTx(tx: TenantTx, schoolId: string, dto: CreateEmployeeDto, actorUserId: string, historyReason = 'Hired') {
    assertDobBeforeJoin(dto.dateOfBirth, dto.joinDate);
    await lock(tx, `staff:${schoolId}`);
    await assertActiveCampus(tx, dto.campusId);
    await assertStaffCapacity(tx, schoolId);

    const employeeNo = dto.employeeNo ?? (await nextEmployeeNo(tx));
    // Sign-in is by User ID (TCH-<joining year>-…); the personal email is the login's contact address.
    const login = dto.login
      ? await this.accounts.createLogin(tx, schoolId, { firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone, email: dto.email, year: Number(String(dto.joinDate).slice(0, 4)) }, dto.login.roles)
      : null;
    const userId = login?.userId ?? null;

    const employee = await tx.employee.create({
      data: {
        schoolId,
        campusId: dto.campusId,
        userId,
        employeeNo,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        gender: dto.gender ?? null,
        dateOfBirth: dto.dateOfBirth ? toDateOnly(dto.dateOfBirth) : null,
        staffType: dto.staffType,
        designation: dto.designation,
        department: dto.department ?? null,
        employmentType: dto.employmentType ?? 'full_time',
        joinDate: toDateOnly(dto.joinDate),
      },
    });
    await upsertProfiles(tx, schoolId, employee.id, dto.profile, dto.staffType === 'teaching' ? dto.teacherProfile ?? {} : undefined);
    await tx.employeeStatusHistory.create({
      data: { schoolId, employeeId: employee.id, fromStatus: null, toStatus: 'active', reason: historyReason, changedBy: actorUserId },
    });
    return { ...employee, login, credentials: login ? handover(login) : null };
  }

  update(schoolId: string, id: string, dto: UpdateEmployeeDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const current = await tx.employee.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Staff member not found');
      if (dto.campusId && dto.campusId !== current.campusId) await assertActiveCampus(tx, dto.campusId);
      assertDobBeforeJoin(
        dto.dateOfBirth === undefined ? current.dateOfBirth?.toISOString().slice(0, 10) : dto.dateOfBirth,
        dto.joinDate ?? current.joinDate.toISOString().slice(0, 10),
      );
      if (dto.staffType === 'non_teaching' && current.staffType === 'teaching') {
        const assigned = await tx.teacherAssignment.count({ where: { employeeId: id } });
        if (assigned > 0) {
          throw new ConflictException(`This teacher has ${assigned} teaching assignment(s). Remove them before changing the staff type.`);
        }
      }
      if (dto.email === null && current.userId) {
        throw new BadRequestException('A staff member with a login must keep an email address');
      }

      const { profile, teacherProfile, ...fields } = dto;
      const updated = await tx.employee.update({
        where: { id },
        data: {
          ...fields,
          dateOfBirth: dto.dateOfBirth === undefined ? undefined : dto.dateOfBirth ? toDateOnly(dto.dateOfBirth) : null,
          joinDate: dto.joinDate ? toDateOnly(dto.joinDate) : undefined,
        },
      });
      const isTeaching = (dto.staffType ?? current.staffType) === 'teaching';
      await upsertProfiles(tx, schoolId, id, profile, isTeaching ? teacherProfile : undefined);
      // Keep the login's display name in step with the staff record.
      if (current.userId && (dto.firstName || dto.lastName)) {
        await tx.user.update({ where: { id: current.userId }, data: { firstName: updated.firstName, lastName: updated.lastName } });
      }
      return updated;
    });
  }

  /** Records the change; leaving the school disables the login, returning re-enables it. */
  changeStatus(schoolId: string, id: string, dto: ChangeStatusDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await lock(tx, `staff:${schoolId}`);
      const current = await tx.employee.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Staff member not found');
      if (current.status === dto.status) throw new BadRequestException(`Already ${dto.status.replace('_', ' ')}`);

      const leaving = dto.status === 'resigned' || dto.status === 'terminated';
      const returning = !leaving && (current.status === 'resigned' || current.status === 'terminated');
      if (returning) await assertStaffCapacity(tx, schoolId);
      if (leaving && current.userId === actorUserId) {
        throw new ForbiddenException('You cannot end your own employment');
      }

      if (current.userId && (leaving || returning)) {
        await tx.user.update({ where: { id: current.userId }, data: { status: leaving ? 'disabled' : 'active' } });
      }
      await tx.employeeStatusHistory.create({
        data: { schoolId, employeeId: id, fromStatus: current.status, toStatus: dto.status, reason: dto.reason ?? null, changedBy: actorUserId },
      });
      return tx.employee.update({ where: { id }, data: { status: dto.status } });
    });
  }

  /** Gives an existing staff member a login. */
  createLoginFor(schoolId: string, id: string, dto: StaffLoginDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id } });
      if (!employee) throw new NotFoundException('Staff member not found');
      if (employee.userId) throw new ConflictException('This staff member already has a login');
      if (!EMPLOYED.includes(employee.status as (typeof EMPLOYED)[number])) {
        throw new BadRequestException('Only current staff can have a login');
      }
      const login = await this.accounts.createLogin(tx, schoolId, { firstName: employee.firstName, lastName: employee.lastName, phone: employee.phone, email: employee.email, year: employee.joinDate.getUTCFullYear() }, dto.roles);
      await tx.employee.update({ where: { id }, data: { userId: login.userId } });
      return { id, userId: login.userId, login, credentials: handover(login) };
    }).then(async ({ login, ...rest }) => {
      await this.accounts.announce(schoolId, [login]);
      return rest;
    });
  }

  // --- Qualifications & experience ------------------------------------------

  async addQualification(schoolId: string, employeeId: string, dto: QualificationDto) {
    await this.mustExist(schoolId, employeeId);
    return this.prisma.forSchool(schoolId).teacherQualification.create({
      data: { schoolId, employeeId, degree: dto.degree, institution: dto.institution, yearCompleted: dto.yearCompleted ?? null, grade: dto.grade ?? null },
    });
  }

  async removeQualification(schoolId: string, employeeId: string, qualificationId: string) {
    const { count } = await this.prisma.forSchool(schoolId).teacherQualification.deleteMany({ where: { id: qualificationId, employeeId } });
    if (count === 0) throw new NotFoundException('Qualification not found');
  }

  async addExperience(schoolId: string, employeeId: string, dto: ExperienceDto) {
    await this.mustExist(schoolId, employeeId);
    if (dto.endDate && dto.endDate < dto.startDate) throw new BadRequestException('End date must be on or after the start date');
    return this.prisma.forSchool(schoolId).teacherExperience.create({
      data: {
        schoolId,
        employeeId,
        organization: dto.organization,
        role: dto.role,
        startDate: toDateOnly(dto.startDate),
        endDate: dto.endDate ? toDateOnly(dto.endDate) : null,
      },
    });
  }

  async removeExperience(schoolId: string, employeeId: string, experienceId: string) {
    const { count } = await this.prisma.forSchool(schoolId).teacherExperience.deleteMany({ where: { id: experienceId, employeeId } });
    if (count === 0) throw new NotFoundException('Experience entry not found');
  }

  private async mustExist(schoolId: string, id: string) {
    const found = await this.prisma.forSchool(schoolId).employee.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Staff member not found');
  }
}

// --- helpers ------------------------------------------------------------------

async function lock(tx: TenantTx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function assertActiveCampus(tx: TenantTx, campusId: string): Promise<void> {
  const campus = await tx.campus.findUnique({ where: { id: campusId }, select: { isActive: true } });
  if (!campus) throw new NotFoundException('Campus not found');
  if (!campus.isActive) throw new BadRequestException('This campus is inactive');
}

/** Active and on-leave staff count against the subscription tier's max_staff. */
async function assertStaffCapacity(tx: TenantTx, schoolId: string): Promise<void> {
  const sub = await tx.subscription.findFirst({
    where: { schoolId, status: { in: [...LIVE_SUBSCRIPTION] } },
    select: { tier: { select: { name: true, maxStaff: true } } },
  });
  if (!sub) throw new ForbiddenException('The school has no active subscription');
  const max = sub.tier.maxStaff;
  if (max === null) return;
  const employed = await tx.employee.count({ where: { status: { in: [...EMPLOYED] } } });
  if (employed >= max) {
    throw new ForbiddenException(`The ${sub.tier.name} plan allows ${max} staff members. Upgrade to add more.`);
  }
}

/** Next number in the EMP-0001 series (gaps from manual numbers are fine). */
async function nextEmployeeNo(tx: TenantTx): Promise<string> {
  const rows = await tx.employee.findMany({ where: { employeeNo: { startsWith: 'EMP-' } }, select: { employeeNo: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.employeeNo.slice(4)) || 0), 0);
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

function assertDobBeforeJoin(dob: string | null | undefined, join: string): void {
  if (dob && dob >= join) throw new BadRequestException('Date of birth must be before the joining date');
}

async function upsertProfiles(
  tx: TenantTx,
  schoolId: string,
  employeeId: string,
  profile: EmployeeProfileDto | undefined,
  teacherProfile: TeacherProfileDto | undefined,
): Promise<void> {
  if (profile) {
    await tx.employeeProfile.upsert({
      where: { employeeId },
      create: { schoolId, employeeId, ...profile },
      update: profile,
    });
  }
  if (teacherProfile) {
    await tx.teacherProfile.upsert({
      where: { employeeId },
      create: { schoolId, employeeId, ...teacherProfile },
      update: teacherProfile,
    });
  }
}
