import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { AccountsService, handover, type GeneratedLogin } from '../accounts/accounts.service.js';
import { toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import { classify } from '../audit/activity.rules.js';
import { AuthService } from '../auth/auth.service.js';
import { LEADER_DESIGNATIONS, closeTenure, ensureLeaderRecord, openTenure, type LeaderRole } from './leader-record.js';
import { PhotosService } from '../photos/photos.service.js';
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
  ReplaceAdminDto,
} from './staff.dto.js';

const LIVE_SUBSCRIPTION = ['trialing', 'active', 'past_due'] as const;
/** Staff that count against the plan limit and may hold a working login. */
const EMPLOYED = ['active', 'on_leave'] as const;

const LIST_SELECT = {
  id: true,
  photoKey: true,
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
export class StaffService implements OnApplicationBootstrap {
  private readonly log = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly photos: PhotosService,
    private readonly auth: AuthService,
  ) {}

  /** On start: administrators and principals made before they got staff records get one now. */
  async onApplicationBootstrap() {
    try {
      const schools = await this.prisma.school.findMany({ select: { id: true } });
      let added = 0;
      for (const { id } of schools) {
        added += await this.prisma.inSchoolTransaction(id, async (tx) => {
          // Every current admin / principal has a staff record and an open service period.
          const leaders = await tx.user.findMany({
            where: { NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: { in: ['school_admin', 'principal'] } } } } },
            select: { id: true, status: true, employee: { select: { id: true } }, userRoles: { select: { role: { select: { key: true } } } } },
          });
          let made = 0;
          for (const u of leaders) {
            if (!u.employee) made++;
            const keys = u.userRoles.map((r) => r.role.key).filter((k): k is LeaderRole => k === 'school_admin' || k === 'principal');
            for (const k of keys) {
              await ensureLeaderRecord(tx, id, u.id, k);
              if (u.status === 'disabled') await closeTenure(tx, id, u.id, { action: 'suspended', role: k, reason: 'Login was disabled before service records were kept' });
            }
          }
          return made;
        });
      }
      if (added) this.log.log(`staff records created for ${added} administrator(s) / principal(s)`);
    } catch (e) {
      this.log.error(`administrator staff records failed: ${(e as Error).message}`);
    }
  }

  /**
   * The principal's list of every administrator and principal, current and former (they keep their
   * staff record after leaving): role, status, joining and leaving dates.
   */
  async administration(schoolId: string) {
    const rows = await this.prisma.forSchool(schoolId).employee.findMany({
      // By role (current, and former whose login keeps the role) or by the designation their record was made with.
      where: { OR: [{ designation: { in: [...LEADER_DESIGNATIONS] } }, { user: { userRoles: { some: { role: { key: { in: ['school_admin', 'principal'] } } } } } }] },
      orderBy: [{ status: 'asc' }, { joinDate: 'desc' }],
      select: {
        id: true, employeeNo: true, firstName: true, lastName: true, email: true, phone: true, designation: true, status: true, joinDate: true, photoKey: true,
        user: { select: { loginId: true, status: true, lastLoginAt: true, userRoles: { select: { role: { select: { key: true, name: true } } } } } },
        statusHistory: { where: { toStatus: { in: ['resigned', 'terminated'] } }, orderBy: { changedAt: 'desc' }, take: 1, select: { toStatus: true, reason: true, changedAt: true } },
      },
    });
    return rows.map(({ statusHistory, user, ...e }) => ({
      ...e,
      loginId: user?.loginId ?? null,
      loginStatus: user?.status ?? null,
      lastLoginAt: user?.lastLoginAt ?? null,
      roles: user?.userRoles.map((r) => r.role.name) ?? [],
      left: e.status === 'resigned' || e.status === 'terminated' ? statusHistory[0] ?? null : null,
    }));
  }

  /**
   * Service record of a staff member who is or was School Admin / Principal: each period in the role
   * (from, to, how it ended, who took over) and, academic year by academic year, what they did:
   * sign-ins, changes and the risky ones, by area. Read from the logs, which are never deleted with them.
   */
  async serviceRecord(schoolId: string, employeeId: string) {
    const db = this.prisma.forSchool(schoolId);
    const e = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, userId: true, joinDate: true, status: true } });
    if (!e) throw new NotFoundException('Staff member not found');
    const [tenures, years, changes, signins, history] = await Promise.all([
      db.leadershipTenure.findMany({ where: { OR: [{ employeeId }, ...(e.userId ? [{ userId: e.userId }] : [])] }, orderBy: { startedAt: 'desc' } }),
      db.academicYear.findMany({ select: { name: true, startDate: true, endDate: true }, orderBy: { startDate: 'desc' } }),
      e.userId ? db.auditLog.findMany({ where: { actorId: e.userId }, select: { createdAt: true, entity: true, action: true, method: true, path: true }, take: 50_000 }) : [],
      e.userId ? this.prisma.loginEvent.findMany({ where: { schoolId, userId: e.userId }, select: { createdAt: true, success: true }, take: 50_000 }) : [],
      db.employeeStatusHistory.findMany({ where: { employeeId }, orderBy: { changedAt: 'desc' }, select: { fromStatus: true, toStatus: true, reason: true, changedAt: true } }),
    ]);
    const yearOf = (d: Date) => years.find((y) => d >= y.startDate && d <= new Date(y.endDate.getTime() + 86_399_999))?.name ?? String(d.getUTCFullYear());
    const buckets = new Map<string, { signins: number; failedSignins: number; changes: number; risky: number; areas: Map<string, number>; last: Date | null }>();
    const bucket = (d: Date) => {
      const k = yearOf(d);
      if (!buckets.has(k)) buckets.set(k, { signins: 0, failedSignins: 0, changes: 0, risky: 0, areas: new Map(), last: null });
      const b = buckets.get(k)!;
      if (!b.last || d > b.last) b.last = d;
      return b;
    };
    for (const s of signins) { const b = bucket(s.createdAt); if (s.success) b.signins++; else b.failedSignins++; }
    for (const c of changes) {
      const b = bucket(c.createdAt);
      b.changes++;
      if (classify(c).level === 'critical') b.risky++;
      b.areas.set(c.entity, (b.areas.get(c.entity) ?? 0) + 1);
    }
    const order = (k: string) => years.findIndex((y) => y.name === k);
    return {
      tenures,
      history,
      years: [...buckets.entries()]
        .sort(([a, x], [b, y]) => (order(a) >= 0 && order(b) >= 0 ? order(a) - order(b) : (y.last?.getTime() ?? 0) - (x.last?.getTime() ?? 0)))
        .map(([label, b]) => ({ label, signins: b.signins, failedSignins: b.failedSignins, changes: b.changes, risky: b.risky, lastActive: b.last, areas: [...b.areas.entries()].sort((p, q) => q[1] - p[1]).slice(0, 6).map(([area, count]) => ({ area, count })) })),
    };
  }

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

  async create(schoolId: string, dto: CreateEmployeeDto, actorUserId: string) {
    const created = await this.prisma.inSchoolTransaction(schoolId, (tx) => this.createInTx(tx, schoolId, dto, actorUserId));
    if (dto.photoId) await this.photos.setFor(schoolId, 'employee', created.id, dto.photoId);
    // Like every other new login: the person is emailed their User ID (after the commit).
    if (created.login) await this.accounts.announce(schoolId, [created.login]);
    return created;
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
      // Only removing an existing address is refused; a record that never had one (its login does) can still be edited.
      if (dto.email === null && current.email && current.userId) {
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
      if (leaving && current.userId) {
        await assertNotLastAdmin(tx, current.userId);
        await closeTenure(tx, schoolId, current.userId, { action: dto.status as 'resigned' | 'terminated', reason: dto.reason, endedByUserId: actorUserId });
      }
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

  /**
   * Replaces a School Admin in one step, so the school is never left without one: the new admin is
   * made first (the principal themself, an existing staff member, or someone new by email), then the
   * old admin is suspended (login closed) or leaves. All school data stays; the new admin sees it all.
   * Only the principal or a School Admin may do this.
   */
  async replaceAdmin(schoolId: string, leavingId: string, dto: ReplaceAdminDto, actorUserId: string) {
    const result = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { userRoles: { select: { role: { select: { key: true } } } } } });
      if (!actor?.userRoles.some((r) => r.role.key === 'principal' || r.role.key === 'school_admin')) throw new ForbiddenException('Only the principal or a School Admin can replace an admin');
      const leaving = await tx.employee.findUnique({ where: { id: leavingId }, select: { id: true, userId: true, status: true, firstName: true, lastName: true } });
      if (!leaving?.userId) throw new NotFoundException('Administrator not found');
      if (leaving.userId === actorUserId) throw new BadRequestException('You cannot replace yourself; ask the principal or another admin');
      const adminRole = await tx.role.findFirstOrThrow({ where: { key: 'school_admin', isSystem: true }, select: { id: true } });

      // 1. The new admin.
      let newUserId: string;
      let login: GeneratedLogin | null = null;
      if (dto.newAdmin.mode === 'self') {
        newUserId = actorUserId;
      } else if (dto.newAdmin.mode === 'staff') {
        const e = dto.newAdmin.employeeId ? await tx.employee.findUnique({ where: { id: dto.newAdmin.employeeId }, select: { id: true, userId: true, firstName: true, lastName: true, email: true, phone: true, status: true, joinDate: true } }) : null;
        if (!e || !EMPLOYED.includes(e.status as never)) throw new BadRequestException('Choose a current staff member');
        if (e.id === leaving.id) throw new BadRequestException('Choose someone else as the new admin');
        if (e.userId) {
          newUserId = e.userId;
          await tx.user.update({ where: { id: e.userId }, data: { status: 'active' } });
        } else {
          if (!e.email) throw new BadRequestException(`${e.firstName} ${e.lastName} needs an email address on their staff record first`);
          login = await this.accounts.createLogin(tx, schoolId, { firstName: e.firstName, lastName: e.lastName, phone: e.phone, email: e.email, year: e.joinDate.getUTCFullYear() }, ['school_admin']);
          await tx.employee.update({ where: { id: e.id }, data: { userId: login.userId } });
          newUserId = login.userId;
        }
      } else {
        const { firstName, lastName, email } = dto.newAdmin;
        if (!firstName || !lastName || !email) throw new BadRequestException('Enter the new admin\'s name and email');
        login = await this.accounts.createLogin(tx, schoolId, { firstName, lastName, email }, ['school_admin']);
        newUserId = login.userId;
      }
      await tx.userRole.upsert({ where: { userId_roleId: { userId: newUserId, roleId: adminRole.id } }, create: { userId: newUserId, roleId: adminRole.id, schoolId }, update: {} });
      // Their service period as School Admin starts today.
      await openTenure(tx, schoolId, newUserId, 'school_admin', new Date());
      await ensureLeaderRecord(tx, schoolId, newUserId, 'school_admin');

      // 2. The old admin: their service period ends (kept for good), then suspended or leaving. Their work all stays.
      const successor = await tx.user.findUnique({ where: { id: newUserId }, select: { firstName: true, lastName: true, loginId: true } });
      await closeTenure(tx, schoolId, leaving.userId, {
        action: dto.action === 'suspend' ? 'suspended' : dto.action,
        reason: dto.reason ?? 'Replaced as School Admin',
        replacedByName: successor ? `${successor.firstName} ${successor.lastName} (${successor.loginId})` : null,
        endedByUserId: actorUserId,
        role: 'school_admin',
      });
      if (dto.action === 'suspend') {
        await tx.user.update({ where: { id: leaving.userId }, data: { status: 'disabled' } });
      } else {
        await tx.user.update({ where: { id: leaving.userId }, data: { status: 'disabled' } });
        await tx.employeeStatusHistory.create({ data: { schoolId, employeeId: leaving.id, fromStatus: leaving.status, toStatus: dto.action, reason: dto.reason ?? 'Replaced as School Admin', changedBy: actorUserId } });
        await tx.employee.update({ where: { id: leaving.id }, data: { status: dto.action } });
      }
      return { leavingUserId: leaving.userId, login };
    });
    await this.auth.endSessions(schoolId, result.leavingUserId);
    if (result.login) await this.accounts.announce(schoolId, [result.login]);
    return { ok: true, credentials: result.login ? handover(result.login) : null };
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

export async function lock(tx: TenantTx, key: string): Promise<void> {
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

/** A school always keeps an active School Admin: replace one (POST /staff/:id/replace-admin) before they leave. */
async function assertNotLastAdmin(tx: TenantTx, userId: string): Promise<void> {
  const isAdmin = await tx.userRole.count({ where: { userId, role: { key: 'school_admin' } } });
  if (!isAdmin) return;
  const others = await tx.user.count({ where: { id: { not: userId }, status: 'active', NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: 'school_admin' } } } } });
  if (!others) throw new BadRequestException('This is the only School Admin. Add a new admin first (Replace admin).');
}

/** Next number in the EMP-0001 series (gaps from manual numbers are fine). */
export async function nextEmployeeNo(tx: TenantTx): Promise<string> {
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
