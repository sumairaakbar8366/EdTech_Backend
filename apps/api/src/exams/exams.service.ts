import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import type { ExamDto, GradingScaleDto, MarksheetDto, PapersDto } from './exams.dto.js';
import { DEFAULT_BANDS, computeCard, rankByPercentage, validateBands, type Band } from './grading.js';

type Auth = { schoolId: string; userId: string };
const STUDENT_REF = { select: { id: true, firstName: true, lastName: true, admissionNo: true } } as const;

/** Page 10 exam flow: exams → papers → marks → grading → report cards → publish. */
@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Grading scale ------------------------------------------------------------------

  async gradingScale(schoolId: string) {
    return this.prisma.inSchoolTransaction(schoolId, (tx) => ensureScale(tx, schoolId));
  }

  async setGradingScale(schoolId: string, dto: GradingScaleDto) {
    const bands: Band[] = dto.bands.map((b) => ({ grade: b.grade, minPercent: b.minPercent, remark: b.remark })).sort((a, b) => b.minPercent - a.minPercent);
    const error = validateBands(bands);
    if (error) throw new BadRequestException(error);
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const scale = await ensureScale(tx, schoolId);
      return tx.gradingScale.update({ where: { id: scale.id }, data: { bands: bands as unknown as Prisma.InputJsonValue } });
    });
  }

  // --- Exams --------------------------------------------------------------------------

  async list(schoolId: string, academicYearId?: string) {
    const db = this.prisma.forSchool(schoolId);
    const yearId = academicYearId ?? (await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id;
    if (!yearId) return [];
    return db.exam.findMany({
      where: { academicYearId: yearId },
      orderBy: { startDate: 'desc' },
      include: { term: { select: { name: true } }, academicYear: { select: { name: true } }, _count: { select: { subjects: true, reportCards: true } } },
    });
  }

  create(schoolId: string, dto: ExamDto, actorUserId: string) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('The end date cannot be before the start date');
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const year = dto.academicYearId
        ? await tx.academicYear.findUnique({ where: { id: dto.academicYearId } })
        : await tx.academicYear.findFirst({ where: { isCurrent: true } });
      if (!year) throw new BadRequestException('Set a current academic year first');
      await assertTerm(tx, year.id, dto.termId);
      const scale = await ensureScale(tx, schoolId);
      return tx.exam.create({
        data: { schoolId, academicYearId: year.id, termId: dto.termId ?? null, gradingScaleId: scale.id, name: dto.name, startDate: toDateOnly(dto.startDate), endDate: toDateOnly(dto.endDate), createdBy: actorUserId },
      });
    });
  }

  update(schoolId: string, id: string, dto: ExamDto) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('The end date cannot be before the start date');
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const exam = await getExam(tx, id);
      await assertTerm(tx, exam.academicYearId, dto.termId);
      return tx.exam.update({ where: { id }, data: { name: dto.name, termId: dto.termId ?? null, startDate: toDateOnly(dto.startDate), endDate: toDateOnly(dto.endDate) } });
    });
  }

  remove(schoolId: string, id: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const exam = await getExam(tx, id);
      if (exam.status === 'published') throw new ConflictException('Unpublish the results before deleting the exam');
      if (await tx.examResult.count({ where: { examSubject: { examId: id } } })) throw new ConflictException('Marks have been entered for this exam');
      await tx.exam.delete({ where: { id } });
    });
  }

  async get(schoolId: string, id: string) {
    const db = this.prisma.forSchool(schoolId);
    const exam = await db.exam.findUnique({
      where: { id },
      include: {
        term: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true } },
        gradingScale: true,
        subjects: {
          include: { subject: { select: { id: true, name: true, code: true } }, schoolClass: { select: { id: true, name: true, level: true } }, _count: { select: { results: true } } },
          orderBy: [{ schoolClass: { level: 'asc' } }, { examDate: 'asc' }, { subject: { name: 'asc' } }],
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  /** Replaces one class's papers. Papers that already have marks cannot be removed. */
  setPapers(schoolId: string, examId: string, classId: string, dto: PapersDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const exam = await getExam(tx, examId);
      if (exam.status === 'published') throw new ConflictException('Results are published; unpublish to change papers');
      const ids = dto.papers.map((p) => p.subjectId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Each subject can appear once');
      for (const p of dto.papers) {
        if (Number(p.passMarks) > Number(p.maxMarks)) throw new BadRequestException('Pass marks cannot exceed maximum marks');
        if (Number(p.maxMarks) <= 0) throw new BadRequestException('Maximum marks must be greater than zero');
      }
      const offered = await tx.classSubject.count({ where: { classId, subjectId: { in: ids } } });
      if (offered !== ids.length) throw new BadRequestException('Every paper must be a subject taught in this class');
      const existing = await tx.examSubject.findMany({ where: { examId, classId }, include: { _count: { select: { results: true } } } });
      const dropped = existing.filter((e) => !ids.includes(e.subjectId));
      if (dropped.some((d) => d._count.results > 0)) throw new ConflictException('A paper with marks entered cannot be removed');
      await tx.examSubject.deleteMany({ where: { id: { in: dropped.map((d) => d.id) } } });
      for (const p of dto.papers) {
        const data = { examDate: p.examDate ? toDateOnly(p.examDate) : null, maxMarks: p.maxMarks, passMarks: p.passMarks };
        await tx.examSubject.upsert({
          where: { examId_classId_subjectId: { examId, classId, subjectId: p.subjectId } },
          create: { schoolId, examId, classId, subjectId: p.subjectId, ...data },
          update: data,
        });
      }
      return tx.examSubject.findMany({ where: { examId, classId } });
    });
  }

  // --- Marks --------------------------------------------------------------------------

  async marksheet(auth: Auth, examId: string, sectionId: string, subjectId: string) {
    const { paper, exam, section } = await this.paperAccess(auth, examId, sectionId, subjectId);
    const db = this.prisma.forSchool(auth.schoolId);
    const [roster, results] = await Promise.all([
      db.studentEnrollment.findMany({
        where: { sectionId, academicYearId: exam.academicYearId, status: 'enrolled' },
        orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
        select: { rollNo: true, student: STUDENT_REF },
      }),
      db.examResult.findMany({ where: { examSubjectId: paper.id } }),
    ]);
    const byStudent = new Map(results.map((r) => [r.studentId, r]));
    return {
      exam: { id: exam.id, name: exam.name, status: exam.status },
      section,
      paper,
      rows: roster.map((r) => {
        const res = byStudent.get(r.student.id);
        return { ...r.student, rollNo: r.rollNo, marks: res?.marks ?? null, isAbsent: res?.isAbsent ?? false, remarks: res?.remarks ?? null };
      }),
    };
  }

  async saveMarks(auth: Auth, examId: string, dto: MarksheetDto) {
    const { paper, exam } = await this.paperAccess(auth, examId, dto.sectionId, dto.subjectId);
    if (exam.status === 'published') throw new ConflictException('Results are published; ask an administrator to unpublish them first');
    const max = Number(paper.maxMarks);
    return this.prisma.inSchoolTransaction(auth.schoolId, async (tx) => {
      const enrolled = new Set(
        (await tx.studentEnrollment.findMany({ where: { sectionId: dto.sectionId, academicYearId: exam.academicYearId, status: 'enrolled' }, select: { studentId: true } })).map((e) => e.studentId),
      );
      let saved = 0;
      for (const e of dto.entries) {
        if (!enrolled.has(e.studentId)) throw new BadRequestException('A student is not enrolled in this section');
        const absent = e.isAbsent ?? false;
        if (!absent && (e.marks === null || e.marks === undefined)) {
          await tx.examResult.deleteMany({ where: { examSubjectId: paper.id, studentId: e.studentId } }); // cleared
          continue;
        }
        if (!absent && Number(e.marks) > max) throw new BadRequestException(`Marks cannot exceed ${max}`);
        const data = { marks: absent ? null : e.marks!, isAbsent: absent, remarks: e.remarks ?? null, enteredBy: auth.userId };
        await tx.examResult.upsert({
          where: { examSubjectId_studentId: { examSubjectId: paper.id, studentId: e.studentId } },
          create: { schoolId: auth.schoolId, examSubjectId: paper.id, studentId: e.studentId, ...data },
          update: data,
        });
        saved++;
      }
      return { saved };
    });
  }

  /** Marks entry progress per class, section and paper. Teachers see only the papers they teach. */
  async progress(auth: Auth, examId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const perms = (await this.permissions.loadUserAccess(auth.schoolId, auth.userId)).permissions;
    const employee = perms.includes('results:crud') ? null : await db.employee.findUnique({ where: { userId: auth.userId }, select: { id: true } });
    const mine = perms.includes('results:crud')
      ? null
      : new Set((employee ? await db.teacherAssignment.findMany({ where: { employeeId: employee.id }, select: { sectionId: true, subjectId: true } }) : []).map((t) => `${t.sectionId}:${t.subjectId}`));
    const exam = await db.exam.findUnique({ where: { id: examId }, include: { subjects: { include: { subject: { select: { name: true } }, schoolClass: { select: { id: true, name: true, level: true, sections: { select: { id: true, name: true } } } } } } } });
    if (!exam) throw new NotFoundException('Exam not found');
    const [enrolments, results, teachers] = await Promise.all([
      db.studentEnrollment.groupBy({ by: ['sectionId'], where: { academicYearId: exam.academicYearId, status: 'enrolled' }, _count: { _all: true } }),
      db.examResult.findMany({ where: { examSubject: { examId } }, select: { examSubjectId: true, student: { select: { enrollments: { where: { academicYearId: exam.academicYearId }, select: { sectionId: true } } } } } }),
      db.teacherAssignment.findMany({ where: { academicYearId: exam.academicYearId }, select: { sectionId: true, subjectId: true, employee: { select: { firstName: true, lastName: true } } } }),
    ]);
    const size = new Map(enrolments.map((e) => [e.sectionId, e._count._all]));
    const entered = new Map<string, number>();
    for (const r of results) {
      const sectionId = r.student.enrollments[0]?.sectionId;
      if (sectionId) entered.set(`${r.examSubjectId}:${sectionId}`, (entered.get(`${r.examSubjectId}:${sectionId}`) ?? 0) + 1);
    }
    const teacherOf = new Map(teachers.map((t) => [`${t.sectionId}:${t.subjectId}`, `${t.employee.firstName} ${t.employee.lastName}`]));
    return exam.subjects.flatMap((p) =>
      p.schoolClass.sections.filter((s) => !mine || mine.has(`${s.id}:${p.subjectId}`)).map((s) => ({
        classId: p.classId,
        className: p.schoolClass.name,
        level: p.schoolClass.level,
        sectionId: s.id,
        sectionName: s.name,
        subjectId: p.subjectId,
        subject: p.subject.name,
        teacher: teacherOf.get(`${s.id}:${p.subjectId}`) ?? null,
        students: size.get(s.id) ?? 0,
        entered: entered.get(`${p.id}:${s.id}`) ?? 0,
      })),
    ).sort((a, b) => a.level - b.level || a.sectionName.localeCompare(b.sectionName) || a.subject.localeCompare(b.subject));
  }

  // --- Report cards -------------------------------------------------------------------

  /** Grades every enrolled student of every class with papers, and ranks them within their section. */
  generate(schoolId: string, examId: string) {
    return this.prisma.inSchoolTransaction(
      schoolId,
      async (tx) => {
        const exam = await tx.exam.findUnique({ where: { id: examId }, include: { gradingScale: true, subjects: { include: { subject: { select: { name: true } }, results: true } } } });
        if (!exam) throw new NotFoundException('Exam not found');
        if (exam.status === 'published') throw new ConflictException('Results are already published');
        if (exam.subjects.length === 0) throw new BadRequestException('Add papers to the exam first');
        const bands = exam.gradingScale.bands as unknown as Band[];
        const classIds = [...new Set(exam.subjects.map((s) => s.classId))];
        const enrolments = await tx.studentEnrollment.findMany({
          where: { academicYearId: exam.academicYearId, status: 'enrolled', section: { classId: { in: classIds } } },
          select: { studentId: true, sectionId: true, section: { select: { classId: true } } },
        });
        const cards = enrolments.map((e) => {
          const papers = exam.subjects.filter((p) => p.classId === e.section.classId);
          const card = computeCard(
            papers.map((p) => {
              const r = p.results.find((x) => x.studentId === e.studentId);
              return { subject: p.subject.name, maxMarks: Number(p.maxMarks), passMarks: Number(p.passMarks), marks: r?.marks != null ? Number(r.marks) : null, isAbsent: r?.isAbsent ?? false };
            }),
            bands,
          );
          return { ...e, ...card };
        });
        const bySection = new Map<string, typeof cards>();
        for (const c of cards) bySection.set(c.sectionId, [...(bySection.get(c.sectionId) ?? []), c]);
        const now = new Date();
        await tx.reportCard.deleteMany({ where: { examId, studentId: { notIn: cards.map((c) => c.studentId) } } });
        for (const list of bySection.values()) {
          const ranks = rankByPercentage(list);
          for (const c of list) {
            const data = {
              sectionId: c.sectionId,
              totalMarks: c.totalMarks,
              totalMax: c.totalMax,
              percentage: c.percentage,
              grade: c.grade,
              passed: c.passed,
              rank: ranks.get(c)!,
              lines: c.lines as unknown as Prisma.InputJsonValue,
              generatedAt: now,
            };
            await tx.reportCard.upsert({ where: { examId_studentId: { examId, studentId: c.studentId } }, create: { schoolId, examId, studentId: c.studentId, ...data }, update: data });
          }
        }
        return { generated: cards.length, passed: cards.filter((c) => c.passed).length };
      },
      { timeout: 60_000 },
    );
  }

  async publish(schoolId: string, examId: string) {
    const { exam, studentIds } = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const current = await getExam(tx, examId);
      if (current.status === 'published') throw new ConflictException('Already published');
      const cards = await tx.reportCard.findMany({ where: { examId }, select: { studentId: true } });
      if (!cards.length) throw new BadRequestException('Generate report cards before publishing');
      const exam = await tx.exam.update({ where: { id: examId }, data: { status: 'published', publishedAt: new Date() } });
      return { exam, studentIds: cards.map((c) => c.studentId) };
    });
    // Page 11: "Result Published → Student + Parent".
    await this.notifications.notifyStudents(schoolId, studentIds, { students: true, guardians: true }, {
      eventType: 'result_published',
      title: `Results published: ${exam.name}`,
      body: 'The report card is ready to view.',
      link: '/results',
    });
    return exam;
  }

  unpublish(schoolId: string, examId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const exam = await getExam(tx, examId);
      if (exam.status !== 'published') throw new ConflictException('Not published');
      return tx.exam.update({ where: { id: examId }, data: { status: 'draft', publishedAt: null } });
    });
  }

  async setRemarks(schoolId: string, cardId: string, remarks: string | null) {
    const db = this.prisma.forSchool(schoolId);
    const card = await db.reportCard.findUnique({ where: { id: cardId }, include: { exam: { select: { status: true } } } });
    if (!card) throw new NotFoundException('Report card not found');
    if (card.exam.status === 'published') throw new ConflictException('Results are published');
    return db.reportCard.update({ where: { id: cardId }, data: { remarks } });
  }

  /** Staff view of an exam's report cards; teachers see the sections they teach. */
  async reportCards(auth: Auth, examId: string, sectionId?: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const sections = await this.teacherSections(auth, examId);
    if (sectionId && sections && !sections.includes(sectionId)) throw new ForbiddenException();
    return db.reportCard.findMany({
      where: { examId, ...(sectionId ? { sectionId } : sections ? { sectionId: { in: sections } } : {}) },
      orderBy: [{ section: { schoolClass: { level: 'asc' } } }, { section: { name: 'asc' } }, { rank: 'asc' }],
      include: { student: STUDENT_REF, section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } } },
    });
  }

  /** Published report cards of the student (or a parent's child). */
  async myReportCards(auth: Auth, studentId?: string) {
    const who = await this.ownStudent(auth, studentId);
    if (!who) return [];
    return this.prisma.forSchool(auth.schoolId).reportCard.findMany({
      where: { studentId: who, exam: { status: 'published' } },
      orderBy: { exam: { startDate: 'desc' } },
      include: { exam: { select: { id: true, name: true, startDate: true, academicYear: { select: { name: true } } } }, section: { select: { name: true, schoolClass: { select: { name: true } } } } },
    });
  }

  async reportCard(auth: Auth, id: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const card = await db.reportCard.findUnique({
      where: { id },
      include: {
        student: STUDENT_REF,
        section: { select: { name: true, schoolClass: { select: { name: true } } } },
        exam: { select: { id: true, name: true, status: true, startDate: true, endDate: true, academicYear: { select: { name: true } }, gradingScale: { select: { bands: true } } } },
      },
    });
    if (!card) throw new NotFoundException('Report card not found');
    const perms = (await this.permissions.loadUserAccess(auth.schoolId, auth.userId)).permissions;
    const staff = perms.some((p) => p === 'results:crud' || p === 'results:enter');
    if (!staff) {
      const mine = await this.ownStudentIds(auth);
      if (!mine.includes(card.studentId) || card.exam.status !== 'published') throw new NotFoundException('Report card not found');
    }
    const [school, sectionSize] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: auth.schoolId }, select: { name: true } }),
      db.reportCard.count({ where: { examId: card.examId, sectionId: card.sectionId } }),
    ]);
    return { school: school?.name, sectionSize, card };
  }

  async children(auth: Auth) {
    const ids = await this.ownStudentIds(auth);
    if (ids.length < 2) return [];
    return this.prisma.forSchool(auth.schoolId).student.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
  }

  // --- Access helpers -----------------------------------------------------------------

  /** Admin (results CRUD) enters any paper; a teacher only the papers they teach. */
  private async paperAccess(auth: Auth, examId: string, sectionId: string, subjectId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const [exam, section] = await Promise.all([
      db.exam.findUnique({ where: { id: examId } }),
      db.section.findUnique({ where: { id: sectionId }, select: { id: true, name: true, classId: true, schoolClass: { select: { name: true } } } }),
    ]);
    if (!exam) throw new NotFoundException('Exam not found');
    if (!section) throw new NotFoundException('Section not found');
    const paper = await db.examSubject.findUnique({
      where: { examId_classId_subjectId: { examId, classId: section.classId, subjectId } },
      include: { subject: { select: { id: true, name: true } } },
    });
    if (!paper) throw new NotFoundException('This subject is not a paper of the exam for this class');
    const perms = (await this.permissions.loadUserAccess(auth.schoolId, auth.userId)).permissions;
    if (!perms.includes('results:crud')) {
      const employee = await db.employee.findUnique({ where: { userId: auth.userId }, select: { id: true } });
      const teaches = employee && (await db.teacherAssignment.findFirst({ where: { employeeId: employee.id, academicYearId: exam.academicYearId, sectionId, subjectId }, select: { id: true } }));
      if (!teaches) throw new ForbiddenException('You can enter marks only for subjects you teach');
    }
    return { exam, section, paper };
  }

  /** null = all sections (admin); otherwise the sections a teacher teaches in the exam's year. */
  private async teacherSections(auth: Auth, examId: string): Promise<string[] | null> {
    const perms = (await this.permissions.loadUserAccess(auth.schoolId, auth.userId)).permissions;
    if (perms.includes('results:crud')) return null;
    const db = this.prisma.forSchool(auth.schoolId);
    const exam = await db.exam.findUnique({ where: { id: examId }, select: { academicYearId: true } });
    if (!exam) throw new NotFoundException('Exam not found');
    const employee = await db.employee.findUnique({ where: { userId: auth.userId }, select: { id: true } });
    if (!employee) return [];
    const rows = await db.teacherAssignment.findMany({ where: { employeeId: employee.id, academicYearId: exam.academicYearId }, select: { sectionId: true }, distinct: ['sectionId'] });
    return rows.map((r) => r.sectionId);
  }

  private async ownStudentIds(auth: Auth): Promise<string[]> {
    const db = this.prisma.forSchool(auth.schoolId);
    const self = await db.student.findUnique({ where: { userId: auth.userId }, select: { id: true } });
    if (self) return [self.id];
    return (await db.studentGuardian.findMany({ where: { guardian: { userId: auth.userId } }, select: { studentId: true } })).map((l) => l.studentId);
  }

  private async ownStudent(auth: Auth, studentId?: string): Promise<string | null> {
    const ids = await this.ownStudentIds(auth);
    if (studentId) {
      if (!ids.includes(studentId)) throw new ForbiddenException();
      return studentId;
    }
    return ids[0] ?? null;
  }
}

async function ensureScale(tx: TenantTx, schoolId: string) {
  const existing = await tx.gradingScale.findFirst({ where: { isDefault: true } });
  if (existing) return existing;
  return tx.gradingScale.create({ data: { schoolId, name: 'Standard', bands: DEFAULT_BANDS as unknown as Prisma.InputJsonValue, isDefault: true } });
}

async function getExam(tx: TenantTx, id: string) {
  const exam = await tx.exam.findUnique({ where: { id } });
  if (!exam) throw new NotFoundException('Exam not found');
  return exam;
}

async function assertTerm(tx: TenantTx, academicYearId: string, termId?: string | null) {
  if (!termId) return;
  const term = await tx.term.findUnique({ where: { id: termId }, select: { academicYearId: true } });
  if (!term || term.academicYearId !== academicYearId) throw new BadRequestException('The term must belong to the exam’s academic year');
}
