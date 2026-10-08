import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import { PrismaService, type SchoolScopedClient } from '../prisma/prisma.service.js';
import { StaffService } from '../staff/staff.service.js';
import {
  APPLICATION_TRANSITIONS,
  type ApplicationDetailsDto,
  type CreateJobPostDto,
  type HireDto,
  type InterviewResultDto,
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

  async addApplication(schoolId: string, postId: string, dto: ApplicationDetailsDto, source: 'office' | 'website' = 'office') {
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
    return db.jobApplication.create({ data: { schoolId, jobPostId: postId, ...dto, source } });
  }

  async updateApplication(schoolId: string, id: string, dto: ApplicationDetailsDto) {
    const db = this.prisma.forSchool(schoolId);
    const app = await db.jobApplication.findUnique({ where: { id }, select: { status: true } });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status === 'hired') throw new BadRequestException('A hired application can no longer be edited; update the staff record instead');
    return db.jobApplication.update({ where: { id }, data: dto });
  }

  async move(schoolId: string, id: string, dto: MoveApplicationDto) {
    const db = this.prisma.forSchool(schoolId);
    const app = await db.jobApplication.findUnique({ where: { id }, select: { status: true } });
    if (!app) throw new NotFoundException('Application not found');
    if (!APPLICATION_TRANSITIONS[app.status].includes(dto.status)) {
      throw new BadRequestException(`An application that is "${app.status}" cannot move to "${dto.status}"`);
    }
    return db.jobApplication.update({ where: { id }, data: { status: dto.status } });
  }

  // --- Interviews ---------------------------------------------------------------

  scheduleInterview(schoolId: string, applicationId: string, dto: ScheduleInterviewDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const app = await tx.jobApplication.findUnique({ where: { id: applicationId }, select: { status: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (app.status !== 'shortlisted' && app.status !== 'interview') {
        throw new BadRequestException('Shortlist the candidate before scheduling an interview');
      }
      if (app.status === 'shortlisted') await tx.jobApplication.update({ where: { id: applicationId }, data: { status: 'interview' } });
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
  recordInterview(schoolId: string, interviewId: string, dto: InterviewResultDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const interview = await tx.interviewRecord.findUnique({ where: { id: interviewId }, select: { id: true, applicationId: true } });
      if (!interview) throw new NotFoundException('Interview not found');
      const updated = await tx.interviewRecord.update({ where: { id: interviewId }, data: dto });
      if (dto.recommendation === 'yes' || dto.recommendation === 'strong_yes') {
        await tx.jobApplication.updateMany({ where: { id: interview.applicationId, status: 'interview' }, data: { status: 'selected' } });
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
      return { employeeId: employee.id, employeeNo: employee.employeeNo, credentials: employee.credentials };
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

function todayUtc(): Date {
  return toDateOnly(new Date().toISOString().slice(0, 10));
}

async function assertActiveCampus(db: SchoolScopedClient, campusId: string) {
  const campus = await db.campus.findUnique({ where: { id: campusId }, select: { isActive: true } });
  if (!campus) throw new NotFoundException('Campus not found');
  if (!campus.isActive) throw new BadRequestException('This campus is inactive');
}
