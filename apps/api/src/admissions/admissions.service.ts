import { AccountsService, type GeneratedLogin } from '../accounts/accounts.service.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import { PhotosService } from '../photos/photos.service.js';
import { StudentsService } from '../students/students.service.js';
import {
  ADMISSION_TRANSITIONS,
  type ApplicationDto,
  type AssessmentDto,
  type AssessmentResultDto,
  type EnrollApplicantDto,
  type ListApplicationsQuery,
  type MoveAdmissionDto,
} from './admissions.dto.js';

const LIST_INCLUDE = {
  academicYear: { select: { id: true, name: true } },
  schoolClass: { select: { id: true, name: true, level: true } },
  campus: { select: { id: true, name: true, code: true } },
} as const;

/** Page 5 "Admission Process": application → documents → interview/test → review → decision → enrollment. */
@Injectable()
export class AdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
    private readonly accounts: AccountsService,
    private readonly photos: PhotosService,
  ) {}

  async list(schoolId: string, q: ListApplicationsQuery) {
    const db = this.prisma.forSchool(schoolId);
    const where: Prisma.AdmissionApplicationWhereInput = {
      status: q.status,
      classId: q.classId,
      ...(q.q && {
        OR: [
          { firstName: { contains: q.q, mode: 'insensitive' } },
          { lastName: { contains: q.q, mode: 'insensitive' } },
          { applicationNo: { contains: q.q, mode: 'insensitive' } },
          { guardianPhone: { contains: q.q } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      db.admissionApplication.findMany({ where, include: LIST_INCLUDE, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      db.admissionApplication.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async summary(schoolId: string) {
    const rows = await this.prisma.forSchool(schoolId).admissionApplication.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  async get(schoolId: string, id: string) {
    const app = await this.prisma.forSchool(schoolId).admissionApplication.findUnique({
      where: { id },
      include: {
        ...LIST_INCLUDE,
        assessments: { orderBy: { scheduledAt: 'desc' } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
        student: { select: { id: true, admissionNo: true } },
      },
    });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  /** `actorUserId` is null for applications submitted on the school's public website. */
  async create(schoolId: string, dto: ApplicationDto, actorUserId: string | null, source: 'office' | 'website' = 'office') {
    const photoKey = dto.photoId ? await this.photos.claim(schoolId, dto.photoId) : null;
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const yearId = await resolveYear(tx, dto.academicYearId);
      await assertClassAndCampus(tx, dto.classId, dto.campusId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admissions:' + schoolId}, 0))`;
      const applicationNo = await nextApplicationNo(tx);
      const app = await tx.admissionApplication.create({
        data: {
          schoolId,
          applicationNo,
          academicYearId: yearId,
          classId: dto.classId,
          campusId: dto.campusId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          gender: dto.gender ?? null,
          dateOfBirth: toDateOnly(dto.dateOfBirth),
          previousSchool: dto.previousSchool ?? null,
          guardianFirstName: dto.guardianFirstName,
          guardianLastName: dto.guardianLastName,
          guardianRelation: dto.guardianRelation,
          guardianPhone: dto.guardianPhone,
          guardianEmail: dto.guardianEmail ?? null,
          address: dto.address ?? null,
          notes: dto.notes ?? null,
          photoKey,
          source,
        },
      });
      await tx.admissionStatusHistory.create({ data: { schoolId, applicationId: app.id, fromStatus: null, toStatus: 'submitted', note: source === 'website' ? 'Application received from the school website' : 'Application received', changedBy: actorUserId } });
      return app;
    });
  }

  async update(schoolId: string, id: string, { photoId, ...dto }: ApplicationDto) {
    const photoKey = photoId ? await this.photos.claim(schoolId, photoId) : undefined;
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const app = await tx.admissionApplication.findUnique({ where: { id }, select: { status: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (['enrolled', 'rejected', 'withdrawn'].includes(app.status)) throw new BadRequestException('A closed application can no longer be edited');
      const yearId = await resolveYear(tx, dto.academicYearId);
      await assertClassAndCampus(tx, dto.classId, dto.campusId);
      return tx.admissionApplication.update({
        where: { id },
        data: { ...dto, academicYearId: yearId, dateOfBirth: toDateOnly(dto.dateOfBirth), ...(photoKey && { photoKey }) },
      });
    });
  }

  move(schoolId: string, id: string, dto: MoveAdmissionDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const app = await tx.admissionApplication.findUnique({ where: { id }, select: { status: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (!ADMISSION_TRANSITIONS[app.status].includes(dto.status)) {
        throw new BadRequestException(`An application that is "${app.status.replace('_', ' ')}" cannot move to "${dto.status.replace('_', ' ')}"`);
      }
      if (dto.status === 'documents_verified') {
        const docs = await tx.document.count({ where: { ownerType: 'admission_application', ownerId: id } });
        if (docs === 0) throw new BadRequestException('Upload at least one document before verifying documents');
      }
      await tx.admissionStatusHistory.create({ data: { schoolId, applicationId: id, fromStatus: app.status, toStatus: dto.status, note: dto.note ?? null, changedBy: actorUserId } });
      return tx.admissionApplication.update({ where: { id }, data: { status: dto.status } });
    });
  }

  scheduleAssessment(schoolId: string, id: string, dto: AssessmentDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const app = await tx.admissionApplication.findUnique({ where: { id }, select: { status: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (app.status !== 'documents_verified' && app.status !== 'interview_scheduled') {
        throw new BadRequestException('Verify the documents before scheduling an interview or test');
      }
      if (app.status === 'documents_verified') {
        await tx.admissionApplication.update({ where: { id }, data: { status: 'interview_scheduled' } });
        await tx.admissionStatusHistory.create({ data: { schoolId, applicationId: id, fromStatus: app.status, toStatus: 'interview_scheduled', note: `${dto.kind === 'test' ? 'Test' : 'Interview'} scheduled`, changedBy: actorUserId } });
      }
      return tx.admissionInterview.create({ data: { schoolId, applicationId: id, kind: dto.kind, scheduledAt: new Date(dto.scheduledAt), conductedBy: dto.conductedBy } });
    });
  }

  async recordAssessment(schoolId: string, assessmentId: string, dto: AssessmentResultDto) {
    const db = this.prisma.forSchool(schoolId);
    if (!(await db.admissionInterview.findUnique({ where: { id: assessmentId }, select: { id: true } }))) throw new NotFoundException('Interview or test not found');
    return db.admissionInterview.update({ where: { id: assessmentId }, data: dto });
  }

  /** Approved application → student + guardian + enrollment (+ logins), atomically. */
  enroll(schoolId: string, id: string, dto: EnrollApplicantDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(
      schoolId,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'admission-enroll:' + id}, 0))`;
        const app = await tx.admissionApplication.findUnique({ where: { id } });
        if (!app) throw new NotFoundException('Application not found');
        if (app.status !== 'approved') throw new BadRequestException('Only an approved application can be enrolled');

        const section = await tx.section.findUnique({ where: { id: dto.sectionId }, select: { classId: true } });
        if (!section) throw new NotFoundException('Section not found');
        if (section.classId !== app.classId) throw new BadRequestException('Choose a section of the class the student applied for');
        if (dto.parentLogin && !app.guardianEmail) throw new BadRequestException('A parent login needs the guardian’s email on the application');
        const credentials: { who: 'parent' | 'student'; name: string; loginId: string; email: string | null; password: string }[] = [];
        const logins: GeneratedLogin[] = [];

        // Siblings: reuse the guardian already registered with this email.
        const existing = app.guardianEmail
          ? await tx.guardian.findUnique({ where: { schoolId_email: { schoolId, email: app.guardianEmail } }, select: { id: true, userId: true } })
          : null;

        const student = await this.students.createInTx(tx, schoolId, {
          firstName: app.firstName,
          lastName: app.lastName,
          gender: app.gender,
          dateOfBirth: app.dateOfBirth.toISOString().slice(0, 10),
          admissionDate: dto.admissionDate ?? new Date().toISOString().slice(0, 10),
          profile: app.address ? { address: app.address } : undefined,
          previousSchools: app.previousSchool ? [{ schoolName: app.previousSchool }] : undefined,
          guardians: [
            existing
              ? { guardianId: existing.id, relationship: app.guardianRelation, isPrimary: true }
              : {
                  details: { firstName: app.guardianFirstName, lastName: app.guardianLastName, phone: app.guardianPhone, email: app.guardianEmail, address: app.address },
                  relationship: app.guardianRelation,
                  isPrimary: true,
                  login: dto.parentLogin,
                },
          ],
          enrollment: { academicYearId: app.academicYearId, sectionId: dto.sectionId, rollNo: dto.rollNo },
          login: dto.studentLogin,
        }, logins);
        // The picture sent with the application becomes the student's profile picture.
        if (app.photoKey) await tx.student.update({ where: { id: student.id }, data: { photoKey: app.photoKey } });

        // Generated logins by role ("usman.tariq.parent@…", "hania.usman.student@…"); a sibling's
        // parent who already has a login keeps it.
        // People sign in with their own email: without one on the application the parent login waits.
        if (dto.createParentLogin && !dto.parentLogin && app.guardianEmail) {
          const link = await tx.studentGuardian.findFirst({ where: { studentId: student.id, isPrimary: true }, select: { guardian: { select: { id: true, userId: true } } } });
          if (link && !link.guardian.userId) {
            const login = await this.accounts.createLogin(tx, schoolId, { firstName: app.guardianFirstName, lastName: app.guardianLastName, phone: app.guardianPhone, email: app.guardianEmail }, ['parent']);
            await tx.guardian.update({ where: { id: link.guardian.id }, data: { userId: login.userId } });
            credentials.push({ who: 'parent', name: login.name, loginId: login.loginId, email: login.email, password: login.password });
            logins.push(login);
          }
        }
        if (dto.createStudentLogin && !dto.studentLogin) {
          const login = await this.accounts.createLogin(tx, schoolId, { firstName: app.firstName, lastName: app.lastName, year: student.admissionDate.getUTCFullYear() }, ['student']);
          await tx.student.update({ where: { id: student.id }, data: { userId: login.userId } });
          credentials.push({ who: 'student', name: login.name, loginId: login.loginId, email: null, password: login.password });
          logins.push(login);
        }

        await tx.admissionStatusHistory.create({ data: { schoolId, applicationId: id, fromStatus: 'approved', toStatus: 'enrolled', note: `Enrolled as ${student.admissionNo}`, changedBy: actorUserId } });
        await tx.admissionApplication.update({ where: { id }, data: { status: 'enrolled', studentId: student.id } });
        return { studentId: student.id, admissionNo: student.admissionNo, linkedExistingGuardian: !!existing, credentials, logins };
      },
      { timeout: 30_000 },
    ).then(async ({ logins, ...rest }) => {
      await this.accounts.announce(schoolId, logins);
      return rest;
    });
  }
}

async function resolveYear(tx: TenantTx, academicYearId?: string): Promise<string> {
  const year = academicYearId
    ? await tx.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true } })
    : await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!year) throw new BadRequestException(academicYearId ? 'Academic year not found' : 'Set a current academic year first');
  return year.id;
}

async function assertClassAndCampus(tx: TenantTx, classId: string, campusId: string): Promise<void> {
  const [cls, campus] = await Promise.all([
    tx.schoolClass.findUnique({ where: { id: classId }, select: { id: true } }),
    tx.campus.findUnique({ where: { id: campusId }, select: { isActive: true } }),
  ]);
  if (!cls) throw new NotFoundException('Class not found');
  if (!campus) throw new NotFoundException('Campus not found');
  if (!campus.isActive) throw new BadRequestException('This campus is inactive');
}

/** APP-<year>-0001, numbered per calendar year. */
async function nextApplicationNo(tx: TenantTx): Promise<string> {
  const prefix = `APP-${new Date().getUTCFullYear()}-`;
  const rows = await tx.admissionApplication.findMany({ where: { applicationNo: { startsWith: prefix } }, select: { applicationNo: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.applicationNo.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
