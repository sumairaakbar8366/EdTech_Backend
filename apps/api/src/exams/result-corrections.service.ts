import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../communication/notifications.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import { computeCard, rankByPercentage, type Band, type PaperIn } from './grading.js';

export interface CorrectionInput {
  /** Changed subject lines (by subject name); marks null = absent when isAbsent is true. */
  lines?: { subject: string; marks: number | null; isAbsent: boolean }[];
  /** true = pass, false = fail, null = back to the result from the marks, undefined = unchanged. */
  passOverride?: boolean | null;
  remarks?: string | null;
  reason: string;
}

type Line = PaperIn & { grade: string; passed: boolean };

const snapshot = (c: { totalMarks: unknown; percentage: unknown; grade: string; passed: boolean; lines: unknown; remarks?: string | null }) => ({
  totalMarks: Number(c.totalMarks),
  percentage: Number(c.percentage),
  grade: c.grade,
  passed: c.passed,
  remarks: c.remarks ?? null,
  lines: c.lines,
});

/**
 * Administrator corrections to any report card, from any exam or year, published or not: change
 * subject marks (totals, grade and rank are recalculated and the marks sheet is updated too) and/or
 * declare the student passed or failed regardless of the marks. Every change keeps a reason and a
 * before / after copy; families are told when a published result changes.
 */
@Injectable()
export class ResultCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async search(schoolId: string, q: { q?: string; examId?: string; classId?: string; passed?: boolean; page: number; pageSize: number }) {
    const term = q.q?.trim();
    const where: Prisma.ReportCardWhereInput = {
      examId: q.examId,
      passed: q.passed,
      ...(q.classId && { section: { classId: q.classId } }),
      ...(term && {
        student: { OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { admissionNo: { contains: term, mode: 'insensitive' } }] },
      }),
    };
    const db = this.prisma.forSchool(schoolId);
    const [items, total] = await Promise.all([
      db.reportCard.findMany({
        where,
        orderBy: [{ exam: { startDate: 'desc' } }, { student: { firstName: 'asc' } }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
          exam: { select: { id: true, name: true, status: true, startDate: true, academicYear: { select: { name: true } } } },
          section: { select: { name: true, schoolClass: { select: { name: true } } } },
          _count: { select: { changes: true } },
        },
      }),
      db.reportCard.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async detail(schoolId: string, id: string) {
    const card = await this.prisma.forSchool(schoolId).reportCard.findUnique({
      where: { id },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        exam: { select: { id: true, name: true, status: true, academicYear: { select: { name: true } } } },
        section: { select: { name: true, schoolClass: { select: { name: true } } } },
        changes: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!card) throw new NotFoundException('Report card not found');
    return card;
  }

  async correct(schoolId: string, actorId: string, id: string, input: CorrectionInput) {
    if (!input.reason?.trim()) throw new BadRequestException('Give the reason for the change (kept in the history)');
    const result = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const card = await tx.reportCard.findUnique({
        where: { id },
        include: { exam: { include: { gradingScale: true, subjects: { include: { subject: { select: { name: true } } } } } }, section: { select: { classId: true } } },
      });
      if (!card) throw new NotFoundException('Report card not found');
      const before = snapshot(card);
      const papers = card.exam.subjects.filter((p) => p.classId === card.section.classId);
      const current = card.lines as unknown as Line[];

      // Merge the changed lines into the card's papers (same subjects, same maxima).
      const changes = new Map((input.lines ?? []).map((l) => [l.subject, l]));
      for (const name of changes.keys()) if (!current.some((l) => l.subject === name)) throw new BadRequestException(`${name} is not a paper on this report card`);
      const merged: PaperIn[] = current.map((l) => {
        const c = changes.get(l.subject);
        if (!c) return { subject: l.subject, maxMarks: l.maxMarks, passMarks: l.passMarks, marks: l.marks, isAbsent: l.isAbsent };
        // Blank marks (not absent) = not entered yet, as on the marks sheet.
        if (!c.isAbsent && c.marks !== null && (c.marks < 0 || c.marks > l.maxMarks)) throw new BadRequestException(`${l.subject}: marks must be between 0 and ${l.maxMarks}`);
        return { subject: l.subject, maxMarks: l.maxMarks, passMarks: l.passMarks, marks: c.isAbsent ? null : c.marks, isAbsent: c.isAbsent };
      });
      const computed = computeCard(merged, card.exam.gradingScale.bands as unknown as Band[]);
      const passOverride = input.passOverride === undefined ? card.passOverride : input.passOverride;
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true } });
      const actorName = actor ? `${actor.firstName} ${actor.lastName}` : 'Administrator';

      // Keep the marks sheet in step, so regenerating gives the same result.
      for (const [name, c] of changes) {
        const paper = papers.find((p) => p.subject.name === name);
        if (!paper) continue;
        if (!c.isAbsent && c.marks === null) {
          // Back to "not entered": the marks sheet has no row for it.
          await tx.examResult.deleteMany({ where: { examSubjectId: paper.id, studentId: card.studentId } });
          continue;
        }
        await tx.examResult.upsert({
          where: { examSubjectId_studentId: { examSubjectId: paper.id, studentId: card.studentId } },
          create: { schoolId, examSubjectId: paper.id, studentId: card.studentId, marks: c.isAbsent ? null : c.marks, isAbsent: c.isAbsent, enteredBy: actorId },
          update: { marks: c.isAbsent ? null : c.marks, isAbsent: c.isAbsent, enteredBy: actorId },
        });
      }
      const updated = await tx.reportCard.update({
        where: { id },
        data: {
          totalMarks: computed.totalMarks,
          totalMax: computed.totalMax,
          percentage: computed.percentage,
          grade: computed.grade,
          passed: passOverride ?? computed.passed,
          passOverride,
          lines: computed.lines as unknown as Prisma.InputJsonValue,
          ...(input.remarks !== undefined && { remarks: input.remarks }),
          editedAt: new Date(),
          editedByName: actorName,
        },
      });
      await rerank(tx, card.examId, card.sectionId);
      await tx.reportCardChange.create({
        data: { schoolId, reportCardId: id, changedBy: actorId, changedByName: actorName, reason: input.reason.trim(), before: before as Prisma.InputJsonValue, after: snapshot(updated) as Prisma.InputJsonValue },
      });
      return { updated, published: card.exam.status === 'published', examName: card.exam.name, before };
    });
    if (result.published && (result.before.passed !== result.updated.passed || result.before.percentage !== Number(result.updated.percentage))) {
      await this.notifications.notifyStudents(schoolId, [result.updated.studentId], { students: true, guardians: true }, {
        eventType: 'result_updated',
        title: `Result updated: ${result.examName}`,
        body: `The school corrected this report card: ${Number(result.updated.percentage)}% · ${result.updated.passed ? 'Passed' : 'Not passed'}.`,
        link: '/results',
      });
    }
    return this.detail(schoolId, id);
  }
}

/** Positions within the section after a change of percentage. */
async function rerank(tx: TenantTx, examId: string, sectionId: string) {
  const cards = await tx.reportCard.findMany({ where: { examId, sectionId }, select: { id: true, percentage: true } });
  const rows = cards.map((c) => ({ id: c.id, percentage: Number(c.percentage) }));
  const ranks = rankByPercentage(rows);
  for (const r of rows) await tx.reportCard.update({ where: { id: r.id }, data: { rank: ranks.get(r)! } });
}
