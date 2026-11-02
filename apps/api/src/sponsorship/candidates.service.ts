import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { NotificationsService } from '../communication/notifications.service.js';
import { OwnerAlertsService } from '../delivery/owner-alerts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { periodLabel, score, type Scored } from './scoring.js';

export class NominatedStudentDto {
  @IsUUID() studentId: string;
  /** The school's confirmation of need (what it knows about the family): required before a name leaves the school. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @IsNotEmpty() @MinLength(10, { message: 'Write a short note on why the family needs support (at least 10 characters)' }) @MaxLength(1000) needNote: string;
}
export class ConfirmCandidatesDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => NominatedStudentDto) students: NominatedStudentDto[];
}

export interface ShortlistRow extends Scored {
  studentId: string;
  name: string;
  className: string;
  level: number;
  average: number | null;
  attendance: number | null;
  /** confirmed | selected | rejected | awarded when the school already put this student forward this cycle. */
  status: string | null;
}

const DAY = 86_400_000;

/**
 * The school's side of a scholarship: for a program the school was approved for, build a shortlist
 * from its own live data (results, attendance, fee records), let the administrator review it and
 * confirm the students (with a note on their need), and only then do those names reach the platform.
 */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: OwnerAlertsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Programs this school has been approved for and can nominate students to. */
  async programs(schoolId: string) {
    const reqs = await this.prisma.scholarshipRequest.findMany({ where: { schoolId, status: 'approved', program: { status: { in: ['recruiting', 'live'] } } }, include: { program: { include: { sponsor: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' } });
    const counts = await this.prisma.scholarshipCandidate.groupBy({ by: ['programId', 'periodLabel', 'status'], where: { schoolId }, _count: true });
    return reqs.map((r) => {
      const p = r.program;
      const period = periodLabel(p.currentPeriod, new Date().getUTCFullYear());
      const mine = counts.filter((c) => c.programId === p.id && c.periodLabel === period);
      return {
        requestId: r.id, programId: p.id, title: p.title, sponsor: p.sponsor?.name ?? null, description: p.description, criteria: p.criteria, awardAmount: p.awardAmount ? Number(p.awardAmount) : null, currency: p.currency,
        targetLevels: p.targetLevels, continuesToUndergrad: p.continuesToUndergrad, period: p.period, currentPeriod: period, minAverage: p.minAverage, minAttendance: p.minAttendance, needRequired: p.needRequired, slots: p.slots,
        confirmed: mine.reduce((n, c) => n + c._count, 0), selected: mine.filter((c) => c.status === 'selected' || c.status === 'awarded').reduce((n, c) => n + c._count, 0),
      };
    });
  }

  private async load(schoolId: string, requestId: string) {
    const r = await this.prisma.scholarshipRequest.findFirst({ where: { id: requestId, schoolId, status: 'approved' }, include: { program: true } });
    if (!r) throw new NotFoundException('This scholarship is not open to your school.');
    if (r.program.status !== 'recruiting' && r.program.status !== 'live') throw new BadRequestException('This program is not open for nominations right now.');
    return r;
  }

  /** Every enrolled student in the program's classes, scored from the school's own records. */
  async shortlist(schoolId: string, requestId: string): Promise<{ period: string; rows: ShortlistRow[]; eligible: number }> {
    const { program } = await this.load(schoolId, requestId);
    const period = periodLabel(program.currentPeriod, new Date().getUTCFullYear());
    const rules = { minAverage: program.minAverage, minAttendance: program.minAttendance, needRequired: program.needRequired };
    const since = new Date(Date.now() - 365 * DAY);
    const facts = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!year) return [];
      const enrolled = await tx.studentEnrollment.findMany({
        where: { academicYearId: year.id, status: 'enrolled', student: { status: 'active' }, ...(program.targetLevels.length && { section: { schoolClass: { level: { in: program.targetLevels } } } }) },
        select: { studentId: true, student: { select: { firstName: true, lastName: true } }, section: { select: { name: true, schoolClass: { select: { name: true, level: true } } } } },
      });
      const ids = enrolled.map((e) => e.studentId);
      if (!ids.length) return [];
      const [cards, marks, invoices, awards] = await Promise.all([
        tx.reportCard.groupBy({ by: ['studentId'], where: { studentId: { in: ids }, exam: { status: 'published' } }, _avg: { percentage: true } }),
        tx.studentAttendance.groupBy({ by: ['studentId', 'status'], where: { studentId: { in: ids }, markedAt: { gte: since } }, _count: true }),
        tx.invoice.findMany({ where: { studentId: { in: ids }, status: { in: ['pending', 'partial', 'overdue'] } }, select: { studentId: true, status: true, total: true, amountPaid: true } }),
        tx.scholarshipAward.findMany({ where: { studentId: { in: ids }, status: 'active' }, select: { studentId: true } }),
      ]);
      return enrolled.map((e) => {
        const m = marks.filter((x) => x.studentId === e.studentId);
        const total = m.reduce((n, x) => n + x._count, 0);
        const here = m.filter((x) => x.status === 'present' || x.status === 'late').reduce((n, x) => n + x._count, 0);
        const inv = invoices.filter((i) => i.studentId === e.studentId);
        const avg = cards.find((c) => c.studentId === e.studentId)?._avg.percentage;
        return {
          studentId: e.studentId, name: `${e.student.firstName} ${e.student.lastName}`, className: `${e.section.schoolClass.name} ${e.section.name}`, level: e.section.schoolClass.level,
          facts: { average: avg == null ? null : Number(avg), attendance: total ? (here / total) * 100 : null, hasConcession: awards.some((a) => a.studentId === e.studentId), overdueInvoices: inv.filter((i) => i.status === 'overdue').length, outstanding: inv.reduce((n, i) => n + Number(i.total) - Number(i.amountPaid), 0) },
        };
      });
    });
    const put = await this.prisma.scholarshipCandidate.findMany({ where: { programId: program.id, schoolId, periodLabel: period }, select: { studentRef: true, status: true } });
    const rows = facts.map((f): ShortlistRow => ({ studentId: f.studentId, name: f.name, className: f.className, level: f.level, average: f.facts.average, attendance: f.facts.attendance, status: put.find((p) => p.studentRef === f.studentId)?.status ?? null, ...score(f.facts, rules) }))
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.rankScore - a.rankScore || a.name.localeCompare(b.name));
    return { period, rows, eligible: rows.filter((r) => r.eligible).length };
  }

  /** The school confirms students: only people the rules still list are accepted (the list is rebuilt here, never taken from the browser). */
  async confirm(schoolId: string, userId: string, requestId: string, dto: ConfirmCandidatesDto) {
    const req = await this.load(schoolId, requestId);
    if (!dto.students.length) throw new BadRequestException('Choose at least one student.');
    const { period, rows } = await this.shortlist(schoolId, requestId);
    const byId = new Map(rows.map((r) => [r.studentId, r]));
    const data = dto.students.map((s) => {
      const r = byId.get(s.studentId);
      if (!r) throw new BadRequestException('A chosen student is not in this program’s classes.');
      if (!r.eligible) throw new BadRequestException(`${r.name} does not meet the program’s rules: ${r.blockers.join('; ')}.`);
      return { programId: req.programId, schoolId, requestId, periodLabel: period, studentRef: r.studentId, studentName: r.name, className: r.className, level: r.level, average: r.average ?? 0, attendance: r.attendance ?? 0, meritScore: r.meritScore, needScore: r.needScore, rankScore: r.rankScore, reasons: r.reasons, needNote: s.needNote, confirmedBy: userId };
    });
    const { count } = await this.prisma.scholarshipCandidate.createMany({ data, skipDuplicates: true });
    if (count === 0) throw new ConflictException('These students were already put forward for this cycle.');
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } });
    await this.alerts.raise({ kind: 'scholarship_request', title: `${count} student(s) confirmed: ${school?.name}`, body: `${req.program.title} · ${period}`, link: '/scholarships?tab=candidates', schoolId });
    return { confirmed: count, skipped: data.length - count, period };
  }

  /** What the school has put forward and how each was decided. */
  async mine(schoolId: string, requestId: string) {
    const req = await this.load(schoolId, requestId);
    return this.prisma.scholarshipCandidate.findMany({ where: { programId: req.programId, schoolId }, orderBy: [{ periodLabel: 'desc' }, { rankScore: 'desc' }], select: { id: true, periodLabel: true, studentName: true, className: true, status: true, rankScore: true, createdAt: true } });
  }
}
