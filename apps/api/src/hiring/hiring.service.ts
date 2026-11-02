import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { toDateOnly } from '../common/date-only.js';
import { PrismaService, type SchoolScopedClient, type TenantTx } from '../prisma/prisma.service.js';
import { PhotosService } from '../photos/photos.service.js';
import { StaffService } from '../staff/staff.service.js';
import {
  APPLICATION_TRANSITIONS,
  type ApplicationDetailsDto,
  type CreateJobPostDto,
  type HireDto,
  type InterviewResultDto,
  type ListApplicationsQuery,
  type MoveApplicationDto,
  type ScheduleInterviewDto,
  type UpdateJobPostDto,
} from './hiring.dto.js';

const OPEN_PIPELINE = ['applied', 'shortlisted', 'interview', 'selected'] as const;

/** Page 6 hiring process: post a vacancy, collect applications, interview, select, hire. */
@Injectable()
export class HiringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: StaffService,
    private readonly accounts: AccountsService,
    private readonly photos: PhotosService,
  ) {}

  // --- Job posts --------------------------------------------------------------

  async listPosts(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const posts = await db.jobPost.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { campus: { select: { id: true, name: true, code: true } } },
    });
    const counts = await db.jobApplication.groupBy({ by: ['jobPostId', 'status'], _count: { _all: true } });
    return posts.map((p) => {
      const mine = counts.filter((c) => c.jobPostId === p.id);
      const byStatus = Object.fromEntries(mine.map((c) => [c.status, c._count._all]));
      return { ...p, applicationCount: mine.reduce((n, c) => n + c._count._all, 0), byStatus };
    });
  }

  async createPost(schoolId: string, dto: CreateJobPostDto) {
    const db = this.prisma.forSchool(schoolId);
    await assertActiveCampus(db, dto.campusId);
    return db.jobPost.create({
      data: {
        schoolId,
        campusId: dto.campusId,
        title: dto.title,
        staffType: dto.staffType,
        department: dto.department ?? null,
        description: dto.description ?? null,
        openings: dto.openings ?? 1,
        status: dto.status ?? 'draft',
        closingDate: dto.closingDate ? toDateOnly(dto.closingDate) : null,
      },
    });
  }

  async updatePost(schoolId: string, id: string, dto: UpdateJobPostDto) {
    const db = this.prisma.forSchool(schoolId);
    const post = await db.jobPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Job post not found');
    if (dto.campusId) await assertActiveCampus(db, dto.campusId);
    if (dto.openings !== undefined) {
      const hired = await db.jobApplication.count({ where: { jobPostId: id, status: 'hired' } });
      if (dto.openings < hired) throw new BadRequestException(`${hired} candidate(s) are already hired for this post`);
    }
    return db.jobPost.update({
      where: { id },
      data: {
        ...dto,
        closingDate: dto.closingDate === undefined ? undefined : dto.closingDate ? toDateOnly(dto.closingDate) : null,
      },
    });
  }

  // --- Applications -------------------------------------------------------------

  async listApplications(schoolId: string, postId: string) {
    const db = this.prisma.forSchool(schoolId);
    const post = await db.jobPost.findUnique({ where: { id: postId }, include: { campus: { select: { id: true, name: true, code: true } } } });
    if (!post) throw new NotFoundException('Job post not found');
    const applications = await db.jobApplication.findMany({
      where: { jobPostId: postId },
      orderBy: { createdAt: 'asc' },
      include: { interviews: { orderBy: { scheduledAt: 'desc' } } },
    });
    return { post, applications };
  }

  /** Every application (all posts, or one), newest first: the hiring log with its status column. */
  async listAll(schoolId: string, q: ListApplicationsQuery) {
    const db = this.prisma.forSchool(schoolId);
    const term = q.q?.trim();
    const where: Prisma.JobApplicationWhereInput = {
      jobPostId: q.postId,
      status: q.status,
      ...(term && { OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { email: { contains: term.toLowerCase() } }, { phone: { contains: term } }, { cnic: { contains: term } }] }),
    };
    const [items, total, byStatus] = await Promise.all([
      db.jobApplication.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          jobPost: { select: { id: true, title: true, staffType: true } },
          history: { orderBy: { createdAt: 'desc' }, take: 1 },
          interviews: { orderBy: { scheduledAt: 'desc' }, take: 1, select: { scheduledAt: true, score: true, recommendation: true } },
        },
      }),
      db.jobApplication.count({ where }),
      db.jobApplication.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true } }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])) };
  }

  /** The full applicant profile: every detail, the post, interviews, the status log and documents. */
  async getApplication(schoolId: string, id: string) {
    const db = this.prisma.forSchool(schoolId);
    const app = await db.jobApplication.findUnique({
      where: { id },
      include: {
        jobPost: { include: { campus: { select: { id: true, name: true, code: true } } } },
        interviews: { orderBy: { scheduledAt: 'desc' } },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!app) throw new NotFoundException('Application not found');
    const hiredCount = await db.jobApplication.count({ where: { jobPostId: app.jobPostId, status: 'hired' } });
    return { ...app, hiredCount };
  }

  async addApplication(schoolId: string, postId: string, { photoId, ...dto }: ApplicationDetailsDto, source: 'office' | 'website' = 'office', actorUserId?: string) {
    const db = this.prisma.forSchool(schoolId);
    const post = await db.jobPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Job post not found');
    if (post.status !== 'open') throw new BadRequestException('Applications can only be added to an open post');
    if (post.closingDate && post.closingDate < todayUtc()) {
      throw new BadRequestException('The closing date for this post has passed');
    }
    if (await db.jobApplication.findFirst({ where: { jobPostId: postId, email: dto.email, status: { notIn: ['rejected', 'withdrawn'] } }, select: { id: true } })) {
      throw new ConflictException(`${dto.email} has already applied for this post`);
    }
    const photoKey = photoId ? await this.photos.claim(schoolId, photoId) : null;
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const app = await tx.jobApplication.create({ data: { schoolId, jobPostId: postId, ...details(dto), photoKey, source } });
      await logStatus(tx, schoolId, app.id, null, 'applied', source === 'website' ? 'Applied on the school website' : 'Added by the office', actorUserId);
      return app;
    });
  }

  async updateApplication(schoolId: string, id: string, { photoId, ...dto }: ApplicationDetailsDto) {
    const db = this.prisma.forSchool(schoolId);
    const app = await db.jobApplication.findUnique({ where: { id }, select: { status: true } });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status === 'hired') throw new BadRequestException('A hired application can no longer be edited; update the staff record instead');
    const photoKey = photoId ? await this.photos.claim(schoolId, photoId) : undefined;
    return db.jobApplication.update({ where: { id }, data: { ...details(dto), ...(photoKey && { photoKey }) } });
  }

  move(schoolId: string, id: string, dto: MoveApplicationDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const app = await tx.jobApplication.findUnique({ where: { id }, select: { status: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (!APPLICATION_TRANSITIONS[app.status].includes(dto.status)) {
        throw new BadRequestException(`An application that is "${app.status}" cannot move to "${dto.status}"`);
      }
      const updated = await tx.jobApplication.update({ where: { id }, data: { status: dto.status } });
      await logStatus(tx, schoolId, id, app.status, dto.status, dto.note ?? null, actorUserId);
      return updated;
    });
  }

  // --- Interviews ---------------------------------------------------------------

  scheduleInterview(schoolId: string, applicationId: string, dto: ScheduleInterviewDto, actorUserId?: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const app = await tx.jobApplication.findUnique({ where: { id: applicationId }, select: { status: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (app.status !== 'shortlisted' && app.status !== 'interview') {
        throw new BadRequestException('Shortlist the candidate before scheduling an interview');
      }
      if (app.status === 'shortlisted') {
        await tx.jobApplication.update({ where: { id: applicationId }, data: { status: 'interview' } });
        await logStatus(tx, schoolId, applicationId, 'shortlisted', 'interview', `Interview scheduled (${dto.mode ?? 'in_person'}) with ${dto.interviewer}`, actorUserId);
      }
      return tx.interviewRecord.create({
        data: { schoolId, applicationId, scheduledAt: new Date(dto.scheduledAt), mode: dto.mode ?? 'in_person', interviewer: dto.interviewer },
      });
    });
  }

  /**
   * Saves the interview result. A positive recommendation (yes / strong yes) moves a candidate who is
   * at the "Interview" stage to "Selected", so the board reflects the decision; hiring stays a
   * separate, deliberate step. Negative results are left for the panel to reject explicitly.
   */
  recordInterview(schoolId: string, interviewId: string, dto: InterviewResultDto, actorUserId?: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const interview = await tx.interviewRecord.findUnique({ where: { id: interviewId }, select: { id: true, applicationId: true } });
      if (!interview) throw new NotFoundException('Interview not found');
      const updated = await tx.interviewRecord.update({ where: { id: interviewId }, data: dto });
      if (dto.recommendation === 'yes' || dto.recommendation === 'strong_yes') {
        const moved = await tx.jobApplication.updateMany({ where: { id: interview.applicationId, status: 'interview' }, data: { status: 'selected' } });
        if (moved.count) await logStatus(tx, schoolId, interview.applicationId, 'interview', 'selected', `Interview result: ${dto.recommendation === 'strong_yes' ? 'strong yes' : 'yes'}${dto.score ? ` (${dto.score}/10)` : ''}`, actorUserId);
      }
      return updated;
    });
  }

  // --- Hire ---------------------------------------------------------------------

  /** Creates the staff record from a selected application, atomically. */
  hire(schoolId: string, applicationId: string, dto: HireDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'hiring:' + applicationId}, 0))`;
      const app = await tx.jobApplication.findUnique({ where: { id: applicationId }, include: { jobPost: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (app.status !== 'selected') throw new BadRequestException('Only a selected candidate can be hired');

      const hired = await tx.jobApplication.count({ where: { jobPostId: app.jobPostId, status: 'hired' } });
      if (hired >= app.jobPost.openings) {
        throw new ConflictException('All openings for this post are filled. Increase the openings to hire more.');
      }
      if (await tx.employee.findFirst({ where: { email: app.email }, select: { id: true } })) {
        throw new ConflictException('A staff member with this email already exists');
      }

      const employee = await this.staff.createInTx(
        tx,
        schoolId,
        {
          campusId: dto.campusId ?? app.jobPost.campusId,
          firstName: app.firstName,
          lastName: app.lastName,
          email: app.email,
          phone: app.phone,
          staffType: app.jobPost.staffType,
          designation: dto.designation ?? app.jobPost.title,
          department: app.jobPost.department,
          employmentType: dto.employmentType ?? 'full_time',
          joinDate: dto.joinDate,
          login: dto.login,
        },
        actorUserId,
        `Hired through "${app.jobPost.title}"`,
      );
      await tx.jobApplication.update({ where: { id: applicationId }, data: { status: 'hired', employeeId: employee.id } });
      // The picture sent with the application becomes the staff member's profile picture.
      if (app.photoKey) await tx.employee.update({ where: { id: employee.id }, data: { photoKey: app.photoKey } });
      await logStatus(tx, schoolId, applicationId, 'selected', 'hired', `Joined as ${employee.employeeNo} on ${dto.joinDate}`, actorUserId);
      return { employeeId: employee.id, employeeNo: employee.employeeNo, credentials: employee.credentials, login: employee.login };
    }).then(async ({ login, ...rest }) => {
      await this.accounts.announce(schoolId, [login]);
      return rest;
    });
  }

  /** Pipeline numbers for the hiring dashboard. */
  async summary(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [openPosts, inPipeline, interviewsUpcoming] = await Promise.all([
      db.jobPost.count({ where: { status: 'open' } }),
      db.jobApplication.count({ where: { status: { in: [...OPEN_PIPELINE] } } }),
      db.interviewRecord.count({ where: { scheduledAt: { gte: new Date() } } }),
    ]);
    return { openPosts, inPipeline, interviewsUpcoming };
  }
}

/** Turns the date and money fields of an application into their database types. */
function details(dto: ApplicationDetailsDto) {
  return {
    ...dto,
    dateOfBirth: dto.dateOfBirth === undefined ? undefined : dto.dateOfBirth ? toDateOnly(dto.dateOfBirth) : null,
    availableFrom: dto.availableFrom === undefined ? undefined : dto.availableFrom ? toDateOnly(dto.availableFrom) : null,
    cnic: dto.cnic ? dto.cnic.replace(/^(\d{5})-?(\d{7})-?(\d)$/, '$1-$2-$3') : dto.cnic,
  };
}

/** One row in the application's status log, with who did it. */
async function logStatus(tx: TenantTx, schoolId: string, applicationId: string, from: Prisma.ApplicationStatusHistoryCreateInput['fromStatus'], to: Prisma.ApplicationStatusHistoryCreateInput['toStatus'], note: string | null, actorUserId?: string) {
  const actor = actorUserId ? await tx.user.findUnique({ where: { id: actorUserId }, select: { firstName: true, lastName: true } }) : null;
  await tx.applicationStatusHistory.create({
    data: { schoolId, applicationId, fromStatus: from ?? null, toStatus: to, note, changedBy: actorUserId ?? null, changedByName: actor ? `${actor.firstName} ${actor.lastName}` : actorUserId ? null : 'Website' },
  });
}

function todayUtc(): Date {
  return toDateOnly(new Date().toISOString().slice(0, 10));
}

async function assertActiveCampus(db: SchoolScopedClient, campusId: string) {
  const campus = await db.campus.findUnique({ where: { id: campusId }, select: { isActive: true } });
  if (!campus) throw new NotFoundException('Campus not found');
  if (!campus.isActive) throw new BadRequestException('This campus is inactive');
}
