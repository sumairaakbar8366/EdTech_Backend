import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { assertAnswers, cleanCustomForm, readCustomForm, type Answers, type CustomForm, type CustomFormDto } from '../common/custom-form.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The registration forms a school can design, and who each is for. */
export const FORM_KINDS = ['teacher', 'staff', 'student', 'guardian', 'access'] as const;
export type FormKind = (typeof FORM_KINDS)[number];
export const FORM_INFO: Record<FormKind, { title: string; for: string }> = {
  teacher: { title: 'Teacher registration', for: 'Asked when a teacher is added to the school' },
  staff: { title: 'Staff registration', for: 'Asked when a non-teaching staff member is added' },
  student: { title: 'Student registration', for: 'Asked when a student is enrolled or edited' },
  guardian: { title: 'Parent registration', for: 'Asked when a parent or guardian is added' },
  access: { title: 'Access request', for: 'Asked when someone requests a login on the school’s sign-in page' },
};

export type Subject = 'employee' | 'student' | 'guardian' | 'access_request';

/** Custom fields every form already carries when a school has not designed it yet. */
export const isFormKind = (v: string): v is FormKind => (FORM_KINDS as readonly string[]).includes(v);

@Injectable()
export class FormsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(schoolId: string, kind: FormKind): Promise<CustomForm> {
    const row = await this.prisma.forSchool(schoolId).schoolForm.findUnique({ where: { schoolId_kind: { schoolId, kind } } });
    return readCustomForm(row?.definition);
  }

  /** Every form with what it is for (the "Forms" page). */
  async all(schoolId: string) {
    const rows = await this.prisma.forSchool(schoolId).schoolForm.findMany({ where: { schoolId } });
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    return FORM_KINDS.map((kind) => ({ kind, ...FORM_INFO[kind], form: readCustomForm(byKind.get(kind)?.definition), updatedAt: byKind.get(kind)?.updatedAt ?? null }));
  }

  async save(schoolId: string, userId: string, kind: FormKind, dto: CustomFormDto) {
    // Documents attach to a person already on record, so the access-request form (a stranger asking for a login) cannot ask for any.
    const form = cleanCustomForm(dto, [], kind !== 'access');
    const definition = form as unknown as Prisma.InputJsonValue;
    await this.prisma.forSchool(schoolId).schoolForm.upsert({
      where: { schoolId_kind: { schoolId, kind } },
      create: { schoolId, kind, definition, updatedBy: userId },
      update: { definition, updatedBy: userId },
    });
    return { kind, ...FORM_INFO[kind], form };
  }

  /** The form that applies to this person: a teacher's record uses the teacher form, other staff the staff form. */
  async kindFor(schoolId: string, subject: Subject, id: string): Promise<FormKind> {
    const db = this.prisma.forSchool(schoolId);
    if (subject === 'student') {
      if (!(await db.student.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Student not found');
      return 'student';
    }
    if (subject === 'guardian') {
      if (!(await db.guardian.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Parent not found');
      return 'guardian';
    }
    if (subject === 'employee') {
      const e = await db.employee.findUnique({ where: { id }, select: { staffType: true } });
      if (!e) throw new NotFoundException('Staff member not found');
      return e.staffType === 'teaching' ? 'teacher' : 'staff';
    }
    return 'access';
  }

  /** The form with this person's saved answers. */
  async answers(schoolId: string, subject: Subject, id: string) {
    const kind = await this.kindFor(schoolId, subject, id);
    const [form, row] = await Promise.all([
      this.get(schoolId, kind),
      this.prisma.forSchool(schoolId).personCustomData.findUnique({ where: { schoolId_subjectType_subjectId: { schoolId, subjectType: subject, subjectId: id } } }),
    ]);
    return { kind, form, answers: (row?.answers ?? {}) as Answers };
  }

  async saveAnswers(schoolId: string, subject: Subject, id: string, given: unknown) {
    const kind = await this.kindFor(schoolId, subject, id);
    const form = await this.get(schoolId, kind);
    const answers = assertAnswers(form, given);
    // A document answer must be a file really attached to this person.
    const docType = subject === 'employee' ? 'employee' : subject === 'student' ? 'student' : subject === 'guardian' ? 'guardian' : null;
    for (const f of form.fields.filter((x) => x.type === 'file')) {
      const a = answers[f.id] as { documentId: string } | undefined;
      if (!a) continue;
      const ok = docType && (await this.prisma.forSchool(schoolId).document.findFirst({ where: { id: a.documentId, ownerType: docType, ownerId: id }, select: { id: true } }));
      if (!ok) throw new BadRequestException(`${f.label}: that document is not attached to this person`);
    }
    await this.store(schoolId, subject, id, answers);
    return { kind, form, answers };
  }

  /** Saves already-checked answers (used when an access request is approved). */
  store(schoolId: string, subject: Subject, id: string, answers: Answers) {
    const json = answers as unknown as Prisma.InputJsonValue;
    return this.prisma.forSchool(schoolId).personCustomData.upsert({
      where: { schoolId_subjectType_subjectId: { schoolId, subjectType: subject, subjectId: id } },
      create: { schoolId, subjectType: subject, subjectId: id, answers: json },
      update: { answers: json },
    });
  }
}

export function badKind(kind: string): never {
  throw new BadRequestException(`Unknown form "${kind}". Use one of: ${FORM_KINDS.join(', ')}`);
}
