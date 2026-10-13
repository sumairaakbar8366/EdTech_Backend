import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountsService, handover, type GeneratedLogin } from '../accounts/accounts.service.js';
import { toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type {
  CreateStudentDto,
  EmergencyContactDto,
  EnrollDto,
  GuardianDetailsDto,
  GuardianLinkDto,
  ListGuardiansQuery,
  ListStudentsQuery,
  PreviousSchoolDto,
  PromoteDto,
  StudentLoginDto,
  StudentStatusDto,
  UpdateStudentDto,
} from './students.dto.js';

const LIVE_SUBSCRIPTION = ['trialing', 'active', 'past_due'] as const;
const today = () => toDateOnly(new Date().toISOString().slice(0, 10));

const SECTION_SELECT = {
  id: true,
  name: true,
  schoolClass: { select: { id: true, name: true, level: true } },
  campus: { select: { id: true, name: true, code: true } },
} as const;

/** Page 5 "Student Lifecycle": profile, guardians, enrollment, promotion. */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  // --- Queries ------------------------------------------------------------------

  async list(schoolId: string, q: ListStudentsQuery) {
    const db = this.prisma.forSchool(schoolId);
    const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const enrollmentFilter = q.classId || q.sectionId
      ? { some: { academicYearId: year?.id ?? '00000000-0000-0000-0000-000000000000', sectionId: q.sectionId, section: q.classId ? { classId: q.classId } : undefined } }
      : undefined;
    const where: Prisma.StudentWhereInput = {
      status: q.status,
      enrollments: enrollmentFilter,
      ...(q.q && {
        OR: [
          { firstName: { contains: q.q, mode: 'insensitive' } },
          { lastName: { contains: q.q, mode: 'insensitive' } },
          { admissionNo: { contains: q.q, mode: 'insensitive' } },
          { guardians: { some: { guardian: { OR: [{ phone: { contains: q.q } }, { lastName: { contains: q.q, mode: 'insensitive' } }] } } } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      db.student.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          gender: true,
          dateOfBirth: true,
          status: true,
          userId: true,
          enrollments: {
            where: { academicYearId: year?.id ?? '00000000-0000-0000-0000-000000000000' },
            select: { rollNo: true, status: true, section: { select: SECTION_SELECT } },
          },
          guardians: {
            where: { isPrimary: true },
            select: { relationship: true, guardian: { select: { firstName: true, lastName: true, phone: true } } },
          },
        },
      }),
      db.student.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async summary(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const [active, enrolled, female, male, withParentLogin] = await Promise.all([
      db.student.count({ where: { status: 'active' } }),
      year ? db.studentEnrollment.count({ where: { academicYearId: year.id, status: 'enrolled' } }) : 0,
      db.student.count({ where: { status: 'active', gender: 'female' } }),
      db.student.count({ where: { status: 'active', gender: 'male' } }),
      db.guardian.count({ where: { userId: { not: null } } }),
    ]);
    return { active, enrolled, notEnrolled: Math.max(0, active - enrolled), female, male, withParentLogin };
  }

  async get(schoolId: string, id: string) {
    const student = await this.prisma.forSchool(schoolId).student.findUnique({
      where: { id },
      include: {
        profile: true,
        medical: true,
        emergencyContacts: { orderBy: { createdAt: 'asc' } },
        previousSchools: { orderBy: { createdAt: 'asc' } },
        guardians: {
          orderBy: { isPrimary: 'desc' },
          include: { guardian: { include: { user: { select: { id: true, email: true, status: true } }, _count: { select: { children: true } } } } },
        },
        enrollments: {
          orderBy: { academicYear: { startDate: 'desc' } },
          include: { academicYear: { select: { id: true, name: true, isCurrent: true } }, section: { select: SECTION_SELECT } },
        },
        user: { select: { id: true, email: true, status: true, lastLoginAt: true } },
        admissionApplication: { select: { id: true, applicationNo: true } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  /** The signed-in student's own record. */
  async getOwn(schoolId: string, userId: string) {
    const s = await this.prisma.forSchool(schoolId).student.findUnique({ where: { userId }, select: { id: true } });
    if (!s) throw new NotFoundException('No student record is linked to your account');
    return this.get(schoolId, s.id);
  }

  /** A parent's children, with their current class. */
  async myChildren(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const guardian = await db.guardian.findUnique({ where: { userId }, select: { id: true } });
    if (!guardian) throw new NotFoundException('No guardian record is linked to your account');
    const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const links = await db.studentGuardian.findMany({
      where: { guardianId: guardian.id },
      select: {
        relationship: true,
        student: {
          select: {
            id: true,
            admissionNo: true,
            firstName: true,
            lastName: true,
            status: true,
            enrollments: { where: { academicYearId: year?.id ?? '00000000-0000-0000-0000-000000000000' }, select: { rollNo: true, section: { select: SECTION_SELECT } } },
          },
        },
      },
    });
    return links.map((l) => ({ relationship: l.relationship, ...l.student }));
  }

  /** A parent may open a child's full record only if linked to that child. */
  async getChild(schoolId: string, userId: string, studentId: string) {
    const db = this.prisma.forSchool(schoolId);
    const linked = await db.studentGuardian.findFirst({ where: { studentId, guardian: { userId } }, select: { studentId: true } });
    if (!linked) throw new ForbiddenException();
    return this.get(schoolId, studentId);
  }

  async listGuardians(schoolId: string, q: ListGuardiansQuery) {
    if (q.phone) {
      // Compare the last 10 digits, so a +92 / 0 prefix and spaces or dashes do not matter.
      const want = q.phone.replace(/\D/g, '').slice(-10);
      if (want.length < 7) return [];
      const rows = await this.prisma.forSchool(schoolId).guardian.findMany({
        where: { phone: { contains: want.slice(-4) } },
        take: 500,
        select: { id: true, firstName: true, lastName: true, phone: true, email: true, _count: { select: { children: true } } },
      });
      return rows.filter((g) => g.phone.replace(/\D/g, '').endsWith(want));
    }
    return this.prisma.forSchool(schoolId).guardian.findMany({
      where: q.q
        ? { OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { email: { contains: q.q, mode: 'insensitive' } }] }
        : undefined,
      take: 20,
      orderBy: [{ lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, _count: { select: { children: true } } },
    });
  }

  // --- Create / update ----------------------------------------------------------

  async create(schoolId: string, dto: CreateStudentDto) {
    const logins: GeneratedLogin[] = [];
    const student = await this.prisma.inSchoolTransaction(schoolId, (tx) => this.createInTx(tx, schoolId, dto, logins), { timeout: 20_000 });
    await this.accounts.announce(schoolId, logins);
    return { ...student, credentials: logins.map(handover) };
  }

  /**
   * Creates a student with guardians and (optionally) enrollment and logins, in one transaction.
   * New logins are appended to `logins`; the caller emails them after the commit (`announce`).
   */
  async createInTx(tx: TenantTx, schoolId: string, dto: CreateStudentDto, logins: GeneratedLogin[] = []) {
    if (dto.dateOfBirth >= dto.admissionDate) throw new BadRequestException('Date of birth must be before the admission date');
    const primaries = dto.guardians.filter((g) => g.isPrimary).length;
    if (primaries > 1) throw new BadRequestException('Only one guardian can be the primary contact');

    await lock(tx, `students:${schoolId}`);
    await assertStudentCapacity(tx, schoolId);
    const admissionNo = dto.admissionNo ?? (await nextAdmissionNo(tx));

    const login = dto.login
      ? await this.accounts.createLogin(tx, schoolId, { email: dto.login.email, firstName: dto.firstName, lastName: dto.lastName, year: Number(dto.admissionDate.slice(0, 4)) }, ['student'], { password: dto.login.password })
      : null;
    if (login) logins.push(login);
    const userId = login?.userId ?? null;

    const student = await tx.student.create({
      data: {
        schoolId,
        userId,
        admissionNo,
        firstName: dto.firstName,
        lastName: dto.lastName,
        gender: dto.gender ?? null,
        dateOfBirth: toDateOnly(dto.dateOfBirth),
        admissionDate: toDateOnly(dto.admissionDate),
      },
    });
    if (dto.profile) await tx.studentProfile.create({ data: { schoolId, studentId: student.id, ...dto.profile } });
    if (dto.medical) await tx.studentMedicalRecord.create({ data: { schoolId, studentId: student.id, ...dto.medical } });
    for (const c of dto.emergencyContacts ?? []) await tx.studentEmergencyContact.create({ data: { schoolId, studentId: student.id, ...c } });
    for (const p of dto.previousSchools ?? []) await tx.studentPreviousSchool.create({ data: previousSchoolData(schoolId, student.id, p) });

    for (const [i, link] of dto.guardians.entries()) {
      await this.linkGuardianInTx(tx, schoolId, student.id, { ...link, isPrimary: primaries === 0 ? i === 0 : !!link.isPrimary }, logins);
    }
    if (dto.enrollment) await this.enrollInTx(tx, schoolId, student.id, dto.enrollment, toDateOnly(dto.admissionDate));
    return student;
  }

  update(schoolId: string, id: string, dto: UpdateStudentDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const current = await tx.student.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Student not found');
      const dob = dto.dateOfBirth ?? current.dateOfBirth.toISOString().slice(0, 10);
      const admitted = dto.admissionDate ?? current.admissionDate.toISOString().slice(0, 10);
      if (dob >= admitted) throw new BadRequestException('Date of birth must be before the admission date');

      const { profile, medical, ...fields } = dto;
      const updated = await tx.student.update({
        where: { id },
        data: {
          ...fields,
          dateOfBirth: dto.dateOfBirth ? toDateOnly(dto.dateOfBirth) : undefined,
          admissionDate: dto.admissionDate ? toDateOnly(dto.admissionDate) : undefined,
        },
      });
      if (profile) await tx.studentProfile.upsert({ where: { studentId: id }, create: { schoolId, studentId: id, ...profile }, update: profile });
      if (medical) await tx.studentMedicalRecord.upsert({ where: { studentId: id }, create: { schoolId, studentId: id, ...medical }, update: medical });
      // Keep the login's display name in step with the student record.
      if (current.userId && (dto.firstName || dto.lastName)) {
        await tx.user.update({ where: { id: current.userId }, data: { firstName: updated.firstName, lastName: updated.lastName } });
      }
      return updated;
    });
  }

  /** Leaving the school ends the current enrollment and disables the student's login. */
  changeStatus(schoolId: string, id: string, dto: StudentStatusDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await lock(tx, `students:${schoolId}`);
      const s = await tx.student.findUnique({ where: { id } });
      if (!s) throw new NotFoundException('Student not found');
      if (s.status === dto.status) throw new BadRequestException(`Already ${dto.status}`);
      const leaving = dto.status === 'withdrawn' || dto.status === 'graduated';
      if (dto.status === 'active' && s.status !== 'active') await assertStudentCapacity(tx, schoolId);

      if (leaving) {
        await tx.studentEnrollment.updateMany({
          where: { studentId: id, status: 'enrolled' },
          data: { status: dto.status === 'graduated' ? 'completed' : 'withdrawn', endedOn: today() },
        });
      }
      if (s.userId) await tx.user.update({ where: { id: s.userId }, data: { status: dto.status === 'active' ? 'active' : 'disabled' } });
      return tx.student.update({ where: { id }, data: { status: dto.status } });
    });
  }

  // --- Guardians ----------------------------------------------------------------

  addGuardian(schoolId: string, studentId: string, dto: GuardianLinkDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      if (!(await tx.student.findUnique({ where: { id: studentId }, select: { id: true } }))) throw new NotFoundException('Student not found');
      const hasPrimary = (await tx.studentGuardian.count({ where: { studentId, isPrimary: true } })) > 0;
      if (dto.isPrimary && hasPrimary) await tx.studentGuardian.updateMany({ where: { studentId }, data: { isPrimary: false } });
      return this.linkGuardianInTx(tx, schoolId, studentId, { ...dto, isPrimary: dto.isPrimary || !hasPrimary });
    });
  }

  updateGuardian(schoolId: string, guardianId: string, dto: GuardianDetailsDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const g = await tx.guardian.findUnique({ where: { id: guardianId }, select: { userId: true } });
      if (!g) throw new NotFoundException('Guardian not found');
      if (g.userId && !dto.email) throw new BadRequestException('A guardian with a login must keep an email address');
      const updated = await tx.guardian.update({ where: { id: guardianId }, data: dto });
      // Keep the login's display name in step with the guardian record.
      if (g.userId) await tx.user.update({ where: { id: g.userId }, data: { firstName: updated.firstName, lastName: updated.lastName } });
      return updated;
    });
  }

  removeGuardian(schoolId: string, guardianId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const g = await tx.guardian.findUnique({ where: { id: guardianId }, select: { userId: true, _count: { select: { children: true } } } });
      if (!g) throw new NotFoundException('Guardian not found');
      if (g._count.children > 0) throw new ConflictException('This parent is still linked to a child; unlink them first');
      if (g.userId) throw new ConflictException('This parent has a login; disable it in Users & Access instead');
      await tx.guardian.delete({ where: { id: guardianId } });
    });
  }

  setPrimaryGuardian(schoolId: string, studentId: string, guardianId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const link = await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId } } });
      if (!link) throw new NotFoundException('This guardian is not linked to the student');
      await tx.studentGuardian.updateMany({ where: { studentId }, data: { isPrimary: false } });
      return tx.studentGuardian.update({ where: { studentId_guardianId: { studentId, guardianId } }, data: { isPrimary: true } });
    });
  }

  unlinkGuardian(schoolId: string, studentId: string, guardianId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const links = await tx.studentGuardian.findMany({ where: { studentId } });
      const link = links.find((l) => l.guardianId === guardianId);
      if (!link) throw new NotFoundException('This guardian is not linked to the student');
      if (links.length === 1) throw new BadRequestException('A student must have at least one guardian');
      await tx.studentGuardian.delete({ where: { studentId_guardianId: { studentId, guardianId } } });
      if (link.isPrimary) {
        const next = links.find((l) => l.guardianId !== guardianId)!;
        await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId, guardianId: next.guardianId } }, data: { isPrimary: true } });
      }
    });
  }

  private async linkGuardianInTx(tx: TenantTx, schoolId: string, studentId: string, dto: GuardianLinkDto, logins: GeneratedLogin[] = []) {
    let guardianId = dto.guardianId;
    if (guardianId) {
      if (!(await tx.guardian.findUnique({ where: { id: guardianId }, select: { id: true } }))) throw new NotFoundException('Guardian not found');
    } else {
      if (!dto.details) throw new BadRequestException('Give either an existing guardian or the new guardian’s details');
      if (dto.details.email && (await tx.guardian.findUnique({ where: { schoolId_email: { schoolId, email: dto.details.email } }, select: { id: true } }))) {
        throw new ConflictException(`A guardian with the email ${dto.details.email} already exists. Link the existing guardian instead.`);
      }
      if (dto.login && !dto.details.email) throw new BadRequestException('A parent login needs an email address');
      const login = dto.login
        ? await this.accounts.createLogin(tx, schoolId, { firstName: dto.details.firstName, lastName: dto.details.lastName, phone: dto.details.phone, email: dto.details.email }, ['parent'], { password: dto.login.password })
        : null;
      if (login) logins.push(login);
      const userId = login?.userId ?? null;
      guardianId = (await tx.guardian.create({ data: { schoolId, userId, ...dto.details } })).id;
    }
    if (await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId, guardianId } } })) {
      throw new ConflictException('This guardian is already linked to the student');
    }
    return tx.studentGuardian.create({ data: { schoolId, studentId, guardianId, relationship: dto.relationship, isPrimary: !!dto.isPrimary } });
  }

  // --- Logins -------------------------------------------------------------------

  async createStudentLogin(schoolId: string, id: string, dto: StudentLoginDto) {
    const result = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const s = await tx.student.findUnique({ where: { id } });
      if (!s) throw new NotFoundException('Student not found');
      if (s.userId) throw new ConflictException('This student already has a login');
      if (s.status !== 'active') throw new BadRequestException('Only active students can have a login');
      const login = await this.accounts.createLogin(tx, schoolId, { email: dto.email, firstName: s.firstName, lastName: s.lastName, year: s.admissionDate.getUTCFullYear() }, ['student'], { password: dto.password });
      await tx.student.update({ where: { id }, data: { userId: login.userId } });
      return login;
    });
    await this.accounts.announce(schoolId, [result]);
    return { id, userId: result.userId, credentials: handover(result) };
  }

  async createGuardianLogin(schoolId: string, guardianId: string, password?: string) {
    const result = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const g = await tx.guardian.findUnique({ where: { id: guardianId } });
      if (!g) throw new NotFoundException('Guardian not found');
      if (g.userId) throw new ConflictException('This guardian already has a login');
      if (!g.email) throw new BadRequestException('Add an email address to the guardian first');
      const login = await this.accounts.createLogin(tx, schoolId, { firstName: g.firstName, lastName: g.lastName, phone: g.phone, email: g.email }, ['parent'], { password });
      await tx.guardian.update({ where: { id: guardianId }, data: { userId: login.userId } });
      return login;
    });
    await this.accounts.announce(schoolId, [result]);
    return { id: guardianId, userId: result.userId, credentials: handover(result) };
  }

  // --- Enrollment & promotion ---------------------------------------------------

  enroll(schoolId: string, studentId: string, dto: EnrollDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { status: true } });
      if (!s) throw new NotFoundException('Student not found');
      if (s.status !== 'active') throw new BadRequestException('Only active students can be enrolled');
      return this.enrollInTx(tx, schoolId, studentId, dto, today());
    });
  }

  /** Enrolls for a year, or moves the student to another section within that year. */
  private async enrollInTx(tx: TenantTx, schoolId: string, studentId: string, dto: EnrollDto, enrolledOn: Date) {
    const year = dto.academicYearId
      ? await tx.academicYear.findUnique({ where: { id: dto.academicYearId }, select: { id: true } })
      : await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year) throw new BadRequestException(dto.academicYearId ? 'Academic year not found' : 'Set a current academic year first');
    await lock(tx, `section:${dto.sectionId}:${year.id}`);

    const existing = await tx.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId, academicYearId: year.id } } });
    if (existing && existing.status !== 'enrolled') throw new BadRequestException('The enrollment for this year is closed');
    if (!existing || existing.sectionId !== dto.sectionId) await assertSeat(tx, dto.sectionId, year.id);
    if (dto.rollNo) {
      const taken = await tx.studentEnrollment.findFirst({
        where: { academicYearId: year.id, sectionId: dto.sectionId, rollNo: dto.rollNo, NOT: { studentId } },
        select: { id: true },
      });
      if (taken) throw new ConflictException(`Roll number ${dto.rollNo} is already taken in this section`);
    }

    if (existing) {
      return tx.studentEnrollment.update({ where: { id: existing.id }, data: { sectionId: dto.sectionId, rollNo: dto.rollNo ?? null } });
    }
    return tx.studentEnrollment.create({
      data: { schoolId, studentId, academicYearId: year.id, sectionId: dto.sectionId, rollNo: dto.rollNo ?? null, enrolledOn },
    });
  }

  /** Students currently enrolled in a section for a year (for promotion). */
  async promotionCandidates(schoolId: string, academicYearId: string, sectionId: string) {
    const rows = await this.prisma.forSchool(schoolId).studentEnrollment.findMany({
      where: { academicYearId, sectionId, status: 'enrolled', student: { status: 'active' } },
      orderBy: [{ rollNo: 'asc' }, { student: { lastName: 'asc' } }],
      select: { rollNo: true, student: { select: { id: true, firstName: true, lastName: true } } },
    });
    return rows.map((r) => ({ ...r.student, rollNo: r.rollNo }));
  }

  /** Page 5 "Promotion → Next Academic Year". */
  promote(schoolId: string, dto: PromoteDto) {
    if (dto.fromAcademicYearId === dto.toAcademicYearId) throw new BadRequestException('Choose a different academic year to promote into');
    return this.prisma.inSchoolTransaction(
      schoolId,
      async (tx) => {
        const [fromYear, toYear] = await Promise.all([
          tx.academicYear.findUnique({ where: { id: dto.fromAcademicYearId } }),
          tx.academicYear.findUnique({ where: { id: dto.toAcademicYearId } }),
        ]);
        if (!fromYear || !toYear) throw new NotFoundException('Academic year not found');
        if (toYear.startDate <= fromYear.startDate) throw new BadRequestException('Students can only be promoted into a later academic year');
        await lock(tx, `section:${dto.toSectionId}:${toYear.id}`);

        const current = await tx.studentEnrollment.findMany({
          where: { academicYearId: fromYear.id, sectionId: dto.fromSectionId, studentId: { in: dto.studentIds }, status: 'enrolled' },
        });
        if (current.length !== dto.studentIds.length) {
          throw new BadRequestException('Every selected student must be currently enrolled in the source section and year');
        }
        const already = await tx.studentEnrollment.count({ where: { academicYearId: toYear.id, studentId: { in: dto.studentIds } } });
        if (already > 0) throw new ConflictException(`${already} of the selected students are already enrolled in ${toYear.name}`);

        const section = await tx.section.findUnique({ where: { id: dto.toSectionId }, select: { capacity: true } });
        if (!section) throw new NotFoundException('Target section not found');
        if (section.capacity !== null) {
          const used = await tx.studentEnrollment.count({ where: { academicYearId: toYear.id, sectionId: dto.toSectionId, status: 'enrolled' } });
          if (used + dto.studentIds.length > section.capacity) {
            throw new BadRequestException(`The target section has ${section.capacity - used} free seat(s) for ${dto.studentIds.length} students`);
          }
        }

        await tx.studentEnrollment.updateMany({ where: { id: { in: current.map((e) => e.id) } }, data: { status: 'promoted', endedOn: fromYear.endDate } });
        await tx.studentEnrollment.createMany({
          data: current.map((e) => ({ schoolId, studentId: e.studentId, academicYearId: toYear.id, sectionId: dto.toSectionId, rollNo: e.rollNo, enrolledOn: toYear.startDate })),
        });
        return { promoted: current.length, toAcademicYear: toYear.name };
      },
      { timeout: 30_000 },
    );
  }

  // --- Emergency contacts & previous schools ------------------------------------

  async addEmergencyContact(schoolId: string, studentId: string, dto: EmergencyContactDto) {
    await this.mustExist(schoolId, studentId);
    return this.prisma.forSchool(schoolId).studentEmergencyContact.create({ data: { schoolId, studentId, ...dto } });
  }

  async removeEmergencyContact(schoolId: string, studentId: string, id: string) {
    const { count } = await this.prisma.forSchool(schoolId).studentEmergencyContact.deleteMany({ where: { id, studentId } });
    if (!count) throw new NotFoundException('Contact not found');
  }

  async addPreviousSchool(schoolId: string, studentId: string, dto: PreviousSchoolDto) {
    await this.mustExist(schoolId, studentId);
    return this.prisma.forSchool(schoolId).studentPreviousSchool.create({ data: previousSchoolData(schoolId, studentId, dto) });
  }

  async removePreviousSchool(schoolId: string, studentId: string, id: string) {
    const { count } = await this.prisma.forSchool(schoolId).studentPreviousSchool.deleteMany({ where: { id, studentId } });
    if (!count) throw new NotFoundException('Previous school not found');
  }

  private async mustExist(schoolId: string, id: string) {
    if (!(await this.prisma.forSchool(schoolId).student.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Student not found');
  }
}

// --- helpers --------------------------------------------------------------------

async function lock(tx: TenantTx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** Active students count against the subscription tier's max_students. */
async function assertStudentCapacity(tx: TenantTx, schoolId: string): Promise<void> {
  const sub = await tx.subscription.findFirst({
    where: { schoolId, status: { in: [...LIVE_SUBSCRIPTION] } },
    select: { tier: { select: { name: true, maxStudents: true } } },
  });
  if (!sub) throw new ForbiddenException('The school has no active subscription');
  if (sub.tier.maxStudents === null) return;
  const active = await tx.student.count({ where: { status: 'active' } });
  if (active >= sub.tier.maxStudents) {
    throw new ForbiddenException(`The ${sub.tier.name} plan allows ${sub.tier.maxStudents} students. Upgrade to add more.`);
  }
}

async function assertSeat(tx: TenantTx, sectionId: string, academicYearId: string): Promise<void> {
  const section = await tx.section.findUnique({ where: { id: sectionId }, select: { capacity: true, campus: { select: { isActive: true } } } });
  if (!section) throw new NotFoundException('Section not found');
  if (!section.campus.isActive) throw new BadRequestException('This section is at an inactive campus');
  if (section.capacity === null) return;
  const used = await tx.studentEnrollment.count({ where: { sectionId, academicYearId, status: 'enrolled' } });
  if (used >= section.capacity) throw new BadRequestException(`This section is full (${section.capacity} seats)`);
}

async function nextAdmissionNo(tx: TenantTx): Promise<string> {
  const rows = await tx.student.findMany({ where: { admissionNo: { startsWith: 'ADM-' } }, select: { admissionNo: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.admissionNo.slice(4)) || 0), 0);
  return `ADM-${String(max + 1).padStart(4, '0')}`;
}

function previousSchoolData(schoolId: string, studentId: string, p: PreviousSchoolDto) {
  return {
    schoolId,
    studentId,
    schoolName: p.schoolName,
    lastClass: p.lastClass ?? null,
    leftOn: p.leftOn ? toDateOnly(p.leftOn) : null,
    reason: p.reason ?? null,
  };
}
