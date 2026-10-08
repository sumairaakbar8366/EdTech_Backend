import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LMS_TYPES, detectAllowedType, safeFileName, type AllowedMime } from '../documents/file-type.js';
import type { MaterialType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { AssignmentDto, CommentDto, GradeDto, MaterialDto, SubmitDto, UpdateMaterialDto } from './lms.dto.js';

/** Hard ceiling, matching the upload interceptor; LMS allows video so it is above MAX_UPLOAD_MB. */
export const LMS_MAX_BYTES = 50 * 1024 * 1024;
const MATERIAL_TYPE: Record<AllowedMime, MaterialType> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'image/png': 'image',
  'image/jpeg': 'image',
  'video/mp4': 'video',
};

type Auth = { schoolId: string; userId: string };
type Upload = Express.Multer.File | undefined;

/** Who the signed-in user is, as far as the LMS is concerned. */
interface Viewer {
  isAdmin: boolean;
  employeeId: string | null;
  /** The student's own record. */
  selfStudentId: string | null;
  /** A parent's children. */
  childIds: string[];
}

const COURSE_INCLUDE = {
  subject: { select: { id: true, name: true, code: true } },
  section: { select: { id: true, name: true, schoolClass: { select: { id: true, name: true, level: true } } } },
  academicYear: { select: { id: true, name: true } },
} as const;

/** Page 10: courses, learning material with threaded discussion, assignments, submissions and grading. */
@Injectable()
export class LmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Courses ------------------------------------------------------------------------

  /** Courses visible to the user in the current academic year (one per teacher assignment). */
  async listCourses(auth: Auth, studentId?: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const year = await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year) return [];
    const v = await this.viewer(auth);

    let sectionIds: string[] | null = null; // null = all sections
    let employeeId: string | undefined;
    if (!v.isAdmin) {
      if (v.employeeId) employeeId = v.employeeId;
      else {
        const ids = studentId ? [this.assertStudentInScope(v, studentId)] : v.selfStudentId ? [v.selfStudentId] : v.childIds;
        const enrolments = await db.studentEnrollment.findMany({ where: { studentId: { in: ids }, academicYearId: year.id, status: 'enrolled' }, select: { sectionId: true } });
        sectionIds = enrolments.map((e) => e.sectionId);
      }
    }
    const assignments = await db.teacherAssignment.findMany({
      where: { academicYearId: year.id, ...(employeeId && { employeeId }), ...(sectionIds && { sectionId: { in: sectionIds } }) },
      select: { academicYearId: true, sectionId: true, subjectId: true, employee: { select: { firstName: true, lastName: true } } },
    });
    if (assignments.length === 0) return [];
    await this.prisma.inSchoolTransaction(auth.schoolId, (tx) =>
      tx.course.createMany({
        data: assignments.map((a) => ({ schoolId: auth.schoolId, academicYearId: a.academicYearId, sectionId: a.sectionId, subjectId: a.subjectId })),
        skipDuplicates: true,
      }),
    );
    const courses = await db.course.findMany({
      where: { academicYearId: year.id, OR: assignments.map((a) => ({ sectionId: a.sectionId, subjectId: a.subjectId })) },
      include: {
        ...COURSE_INCLUDE,
        _count: { select: { materials: { where: { isPublished: true } }, assignments: { where: { isPublished: true } } } },
      },
      orderBy: [{ section: { schoolClass: { level: 'asc' } } }, { section: { name: 'asc' } }, { subject: { name: 'asc' } }],
    });
    const teacherOf = new Map(assignments.map((a) => [`${a.sectionId}:${a.subjectId}`, `${a.employee.firstName} ${a.employee.lastName}`]));
    return courses.map((c) => ({ ...c, teacher: teacherOf.get(`${c.sectionId}:${c.subjectId}`) ?? null }));
  }

  async getCourse(auth: Auth, id: string, studentId?: string) {
    const { course, manage, studentIds } = await this.courseAccess(auth, id);
    const db = this.prisma.forSchool(auth.schoolId);
    const forStudent = studentId ?? studentIds[0];
    if (studentId && !manage && !studentIds.includes(studentId)) throw new ForbiddenException();
    const [materials, assignments, teacher] = await Promise.all([
      db.courseMaterial.findMany({
        where: { courseId: id, ...(!manage && { isPublished: true }) },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, description: true, type: true, fileName: true, mimeType: true, fileSize: true, url: true, isPublished: true, createdAt: true, _count: { select: { comments: { where: { deletedAt: null } } } } },
      }),
      db.assignment.findMany({
        where: { courseId: id, ...(!manage && { isPublished: true }) },
        orderBy: { dueAt: 'desc' },
        select: {
          id: true, title: true, dueAt: true, maxMarks: true, allowLate: true, mode: true, isPublished: true,
          _count: { select: { submissions: true } },
          ...(forStudent && !manage && { submissions: { where: { studentId: forStudent }, select: { status: true, isLate: true, submittedAt: true, grade: { select: { marks: true } } } } }),
        },
      }),
      db.teacherAssignment.findFirst({ where: { academicYearId: course.academicYearId, sectionId: course.sectionId, subjectId: course.subjectId }, select: { employee: { select: { firstName: true, lastName: true } } } }),
    ]);
    return { ...course, teacher: teacher ? `${teacher.employee.firstName} ${teacher.employee.lastName}` : null, canManage: manage, materials, assignments };
  }

  // --- Materials ----------------------------------------------------------------------

  async createMaterial(auth: Auth, courseId: string, dto: MaterialDto, file: Upload) {
    await this.assertManage(auth, courseId);
    if (!file && !dto.url) throw new BadRequestException('Attach a file or give a link');
    if (file && dto.url) throw new BadRequestException('Give either a file or a link, not both');
    const stored = file ? await this.store(auth.schoolId, file) : null;
    try {
      return await this.prisma.forSchool(auth.schoolId).courseMaterial.create({
        data: {
          schoolId: auth.schoolId,
          courseId,
          title: dto.title,
          description: dto.description ?? null,
          type: stored ? MATERIAL_TYPE[stored.mimeType] : 'link',
          url: dto.url ?? null,
          ...(stored && { fileKey: stored.key, fileName: stored.fileName, mimeType: stored.mimeType, fileSize: stored.size }),
          isPublished: dto.isPublished ?? true,
          createdBy: auth.userId,
        },
        omit: { fileKey: true },
      });
    } catch (error) {
      if (stored) await this.storage.delete(stored.key);
      throw error;
    }
  }

  async updateMaterial(auth: Auth, id: string, dto: UpdateMaterialDto) {
    const m = await this.material(auth, id);
    await this.assertManage(auth, m.courseId);
    return this.prisma.forSchool(auth.schoolId).courseMaterial.update({ where: { id }, data: { title: dto.title, description: dto.description ?? null, isPublished: dto.isPublished }, omit: { fileKey: true } });
  }

  async deleteMaterial(auth: Auth, id: string) {
    const m = await this.material(auth, id);
    await this.assertManage(auth, m.courseId);
    await this.prisma.forSchool(auth.schoolId).courseMaterial.delete({ where: { id } });
    if (m.fileKey) await this.storage.delete(m.fileKey);
  }

  async openMaterial(auth: Auth, id: string) {
    const m = await this.material(auth, id);
    const { manage } = await this.courseAccess(auth, m.courseId);
    if (!m.isPublished && !manage) throw new NotFoundException('Material not found');
    if (!m.fileKey) throw new BadRequestException('This material is a link');
    return { file: { name: m.fileName!, mimeType: m.mimeType!, size: m.fileSize! }, stream: this.storage.read(m.fileKey) };
  }

  // --- Comments -----------------------------------------------------------------------

  async listComments(auth: Auth, materialId: string) {
    const m = await this.material(auth, materialId);
    const { manage } = await this.courseAccess(auth, m.courseId);
    if (!m.isPublished && !manage) throw new NotFoundException('Material not found');
    const rows = await this.prisma.forSchool(auth.schoolId).materialComment.findMany({
      where: { materialId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, firstName: true, lastName: true, userRoles: { select: { role: { select: { key: true } } } } } } },
    });
    return rows.map((c) => ({
      id: c.id,
      parentCommentId: c.parentCommentId,
      body: c.deletedAt ? null : c.body,
      isPinned: c.isPinned,
      deleted: !!c.deletedAt,
      createdAt: c.createdAt,
      author: { id: c.user.id, name: `${c.user.firstName} ${c.user.lastName}`, isStaff: c.user.userRoles.some((r) => r.role.key !== 'student' && r.role.key !== 'parent') },
      canDelete: !c.deletedAt && (manage || c.userId === auth.userId),
    }));
  }

  async addComment(auth: Auth, materialId: string, dto: CommentDto) {
    const m = await this.material(auth, materialId);
    const { manage } = await this.courseAccess(auth, m.courseId);
    const v = await this.viewer(auth);
    if (!manage && !v.selfStudentId) throw new ForbiddenException('Only students and teachers of this course can comment');
    if (!m.isPublished && !manage) throw new NotFoundException('Material not found');
    const db = this.prisma.forSchool(auth.schoolId);
    let parentId: string | null = null;
    if (dto.parentCommentId) {
      const parent = await db.materialComment.findUnique({ where: { id: dto.parentCommentId }, select: { materialId: true, parentCommentId: true } });
      if (!parent || parent.materialId !== materialId) throw new BadRequestException('Reply to a comment on this material');
      parentId = parent.parentCommentId ?? dto.parentCommentId; // one level of threading
    }
    return db.materialComment.create({ data: { schoolId: auth.schoolId, materialId, userId: auth.userId, parentCommentId: parentId, body: dto.body } });
  }

  async pinComment(auth: Auth, id: string, pinned: boolean) {
    const c = await this.comment(auth, id);
    await this.assertManage(auth, c.material.courseId);
    return this.prisma.forSchool(auth.schoolId).materialComment.update({ where: { id }, data: { isPinned: pinned } });
  }

  async deleteComment(auth: Auth, id: string) {
    const c = await this.comment(auth, id);
    if (c.userId !== auth.userId) await this.assertManage(auth, c.material.courseId);
    await this.prisma.forSchool(auth.schoolId).materialComment.update({ where: { id }, data: { deletedAt: new Date(), isPinned: false } });
  }

  // --- Assignments --------------------------------------------------------------------

  async createAssignment(auth: Auth, courseId: string, dto: AssignmentDto, file: Upload) {
    await this.assertManage(auth, courseId);
    const stored = file ? await this.store(auth.schoolId, file) : null;
    try {
      const created = await this.prisma.forSchool(auth.schoolId).assignment.create({
        data: {
          schoolId: auth.schoolId,
          courseId,
          title: dto.title,
          instructions: dto.instructions,
          dueAt: new Date(dto.dueAt),
          maxMarks: dto.maxMarks,
          allowLate: dto.allowLate ?? true,
          mode: dto.mode ?? 'file_or_text',
          isPublished: dto.isPublished ?? true,
          createdBy: auth.userId,
          ...(stored && { fileKey: stored.key, fileName: stored.fileName, mimeType: stored.mimeType, fileSize: stored.size }),
        },
        omit: { fileKey: true },
      });
      if (created.isPublished) await this.notifyAssignment(auth.schoolId, courseId, created.id, created.title);
      return created;
    } catch (error) {
      if (stored) await this.storage.delete(stored.key);
      throw error;
    }
  }

  /** Page 11: "Assignment Posted → Student" (and their parents, who follow homework). */
  private async notifyAssignment(schoolId: string, courseId: string, assignmentId: string, title: string) {
    const db = this.prisma.forSchool(schoolId);
    const course = await db.course.findUnique({ where: { id: courseId }, select: { sectionId: true, academicYearId: true, subject: { select: { name: true } } } });
    if (!course) return;
    const students = await db.studentEnrollment.findMany({ where: { sectionId: course.sectionId, academicYearId: course.academicYearId, status: 'enrolled' }, select: { studentId: true } });
    const ids = students.map((s) => s.studentId);
    await this.notifications.notifyStudents(schoolId, ids, { students: true }, { eventType: 'assignment_posted', title: `New assignment: ${title}`, body: course.subject.name, link: `/lms/assignments/${assignmentId}` });
    await this.notifications.notifyStudents(schoolId, ids, { guardians: true }, { eventType: 'assignment_posted', title: `New homework: ${title}`, body: course.subject.name, link: '/homework' });
  }

  async updateAssignment(auth: Auth, id: string, dto: AssignmentDto) {
    const a = await this.assignment(auth, id);
    await this.assertManage(auth, a.courseId);
    const highest = await this.prisma.forSchool(auth.schoolId).grade.findFirst({ where: { submission: { assignmentId: id } }, orderBy: { marks: 'desc' }, select: { marks: true } });
    if (highest && Number(highest.marks) > Number(dto.maxMarks)) throw new BadRequestException('Some grades are above the new maximum');
    return this.prisma.forSchool(auth.schoolId).assignment.update({
      where: { id },
      data: { title: dto.title, instructions: dto.instructions, dueAt: new Date(dto.dueAt), maxMarks: dto.maxMarks, allowLate: dto.allowLate ?? a.allowLate, mode: dto.mode ?? a.mode, isPublished: dto.isPublished ?? a.isPublished },
      omit: { fileKey: true },
    });
  }

  async deleteAssignment(auth: Auth, id: string) {
    const a = await this.assignment(auth, id);
    await this.assertManage(auth, a.courseId);
    const db = this.prisma.forSchool(auth.schoolId);
    if (await db.assignmentSubmission.count({ where: { assignmentId: id } })) throw new ConflictException('Students have already submitted; unpublish it instead');
    await db.assignment.delete({ where: { id } });
    if (a.fileKey) await this.storage.delete(a.fileKey);
  }

  /** Teachers see the class roster with every submission; students and parents see their own. */
  async getAssignment(auth: Auth, id: string, studentId?: string) {
    const a = await this.assignment(auth, id);
    const { course, manage, studentIds } = await this.courseAccess(auth, a.courseId);
    if (!a.isPublished && !manage) throw new NotFoundException('Assignment not found');
    const db = this.prisma.forSchool(auth.schoolId);
    const base = { ...a, fileKey: undefined, course };
    if (manage) {
      const [roster, submissions] = await Promise.all([
        db.studentEnrollment.findMany({
          where: { sectionId: course.sectionId, academicYearId: course.academicYearId, status: 'enrolled' },
          orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
          select: { rollNo: true, student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
        }),
        db.assignmentSubmission.findMany({ where: { assignmentId: id }, include: { grade: true } }),
      ]);
      const byStudent = new Map(submissions.map((s) => [s.studentId, { ...s, fileKey: undefined, hasFile: !!s.fileKey }]));
      return { ...base, canManage: true, roster: roster.map((r) => ({ ...r.student, rollNo: r.rollNo, submission: byStudent.get(r.student.id) ?? null })) };
    }
    const who = studentId ?? studentIds[0];
    if (!who || !studentIds.includes(who)) throw new ForbiddenException();
    const mine = await db.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: id, studentId: who } }, include: { grade: true } });
    return { ...base, canManage: false, submission: mine ? { ...mine, fileKey: undefined, hasFile: !!mine.fileKey } : null };
  }

  async openAssignmentFile(auth: Auth, id: string) {
    const a = await this.assignment(auth, id);
    const { manage } = await this.courseAccess(auth, a.courseId);
    if (!a.isPublished && !manage) throw new NotFoundException('Assignment not found');
    if (!a.fileKey) throw new NotFoundException('This assignment has no attachment');
    return { file: { name: a.fileName!, mimeType: a.mimeType!, size: a.fileSize! }, stream: this.storage.read(a.fileKey) };
  }

  /** Student hands in (or replaces) their work until it is graded. */
  async submit(auth: Auth, id: string, dto: SubmitDto, file: Upload) {
    const a = await this.assignment(auth, id);
    const v = await this.viewer(auth);
    if (!v.selfStudentId) throw new ForbiddenException('Only students can submit');
    const { studentIds } = await this.courseAccess(auth, a.courseId);
    if (!a.isPublished || !studentIds.includes(v.selfStudentId)) throw new NotFoundException('Assignment not found');
    const text = dto.text ?? null;
    if (a.mode === 'file' && !file) throw new BadRequestException('Attach your file');
    if (a.mode === 'text' && !text) throw new BadRequestException('Type your answer');
    if (a.mode === 'text' && file) throw new BadRequestException('This assignment takes a typed answer only');
    if (!file && !text) throw new BadRequestException('Attach a file or type your answer');
    const now = new Date();
    const late = now > a.dueAt;
    if (late && !a.allowLate) throw new BadRequestException('The due date has passed and late submissions are closed');

    const db = this.prisma.forSchool(auth.schoolId);
    const existing = await db.assignmentSubmission.findUnique({ where: { assignmentId_studentId: { assignmentId: id, studentId: v.selfStudentId } } });
    if (existing?.status === 'graded') throw new ConflictException('This work has already been graded');
    const stored = file ? await this.store(auth.schoolId, file) : null;
    const fileData = stored
      ? { fileKey: stored.key, fileName: stored.fileName, mimeType: stored.mimeType, fileSize: stored.size }
      : { fileKey: null, fileName: null, mimeType: null, fileSize: null };
    try {
      const saved = await db.assignmentSubmission.upsert({
        where: { assignmentId_studentId: { assignmentId: id, studentId: v.selfStudentId } },
        create: { schoolId: auth.schoolId, assignmentId: id, studentId: v.selfStudentId, textBody: text, submittedAt: now, isLate: late, ...fileData },
        update: { textBody: text, submittedAt: now, isLate: late, ...fileData },
      });
      if (existing?.fileKey) await this.storage.delete(existing.fileKey);
      return { ...saved, fileKey: undefined };
    } catch (error) {
      if (stored) await this.storage.delete(stored.key);
      throw error;
    }
  }

  async grade(auth: Auth, submissionId: string, dto: GradeDto) {
    const db = this.prisma.forSchool(auth.schoolId);
    const s = await db.assignmentSubmission.findUnique({ where: { id: submissionId }, include: { assignment: true } });
    if (!s) throw new NotFoundException('Submission not found');
    await this.assertManage(auth, s.assignment.courseId);
    if (Number(dto.marks) > Number(s.assignment.maxMarks)) throw new BadRequestException(`Marks cannot exceed ${Number(s.assignment.maxMarks)}`);
    return this.prisma.inSchoolTransaction(auth.schoolId, async (tx) => {
      const grade = await tx.grade.upsert({
        where: { submissionId },
        create: { schoolId: auth.schoolId, submissionId, marks: dto.marks, feedback: dto.feedback ?? null, gradedBy: auth.userId, gradedAt: new Date() },
        update: { marks: dto.marks, feedback: dto.feedback ?? null, gradedBy: auth.userId, gradedAt: new Date() },
      });
      await tx.assignmentSubmission.update({ where: { id: submissionId }, data: { status: 'graded' } });
      return grade;
    });
  }

  async openSubmissionFile(auth: Auth, submissionId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const s = await db.assignmentSubmission.findUnique({ where: { id: submissionId }, include: { assignment: { select: { courseId: true } } } });
    if (!s) throw new NotFoundException('Submission not found');
    const { manage, studentIds } = await this.courseAccess(auth, s.assignment.courseId);
    if (!manage && !studentIds.includes(s.studentId)) throw new ForbiddenException();
    if (!s.fileKey) throw new NotFoundException('No file was submitted');
    return { file: { name: s.fileName!, mimeType: s.mimeType!, size: s.fileSize! }, stream: this.storage.read(s.fileKey) };
  }

  /** A student's (or a parent's child's) assignments across all current courses. */
  async studentAssignments(auth: Auth, studentId?: string) {
    const v = await this.viewer(auth);
    const who = studentId ? this.assertStudentInScope(v, studentId) : v.selfStudentId ?? v.childIds[0];
    if (!who) return [];
    const db = this.prisma.forSchool(auth.schoolId);
    const enrolment = await db.studentEnrollment.findFirst({ where: { studentId: who, status: 'enrolled', academicYear: { isCurrent: true } }, select: { sectionId: true, academicYearId: true } });
    if (!enrolment) return [];
    return db.assignment.findMany({
      where: { isPublished: true, course: { sectionId: enrolment.sectionId, academicYearId: enrolment.academicYearId } },
      orderBy: { dueAt: 'asc' },
      select: {
        id: true, title: true, dueAt: true, maxMarks: true, allowLate: true, mode: true,
        course: { select: { id: true, subject: { select: { name: true } } } },
        submissions: { where: { studentId: who }, select: { status: true, isLate: true, submittedAt: true, grade: { select: { marks: true, feedback: true } } } },
      },
    });
  }

  /** Children a parent may switch between (empty for other roles). */
  async children(auth: Auth) {
    const v = await this.viewer(auth);
    if (v.childIds.length === 0) return [];
    return this.prisma.forSchool(auth.schoolId).student.findMany({ where: { id: { in: v.childIds } }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' } });
  }

  // --- Access -------------------------------------------------------------------------

  private async viewer(auth: Auth): Promise<Viewer> {
    const db = this.prisma.forSchool(auth.schoolId);
    const [access, employee, student, links] = await Promise.all([
      this.permissions.loadUserAccess(auth.schoolId, auth.userId),
      db.employee.findUnique({ where: { userId: auth.userId }, select: { id: true } }),
      db.student.findUnique({ where: { userId: auth.userId }, select: { id: true } }),
      db.studentGuardian.findMany({ where: { guardian: { userId: auth.userId } }, select: { studentId: true } }),
    ]);
    return {
      isAdmin: access.roles.some((r) => r.key === 'school_admin'),
      employeeId: employee?.id ?? null,
      selfStudentId: student?.id ?? null,
      childIds: links.map((l) => l.studentId),
    };
  }

  private assertStudentInScope(v: Viewer, studentId: string): string {
    if (v.selfStudentId === studentId || v.childIds.includes(studentId)) return studentId;
    throw new ForbiddenException();
  }

  /** Loads a course and decides whether the user manages it and which of "their" students take it. */
  private async courseAccess(auth: Auth, courseId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const course = await db.course.findUnique({ where: { id: courseId }, include: COURSE_INCLUDE });
    if (!course) throw new NotFoundException('Course not found');
    const v = await this.viewer(auth);
    const teaches = v.employeeId
      ? !!(await db.teacherAssignment.findFirst({ where: { employeeId: v.employeeId, academicYearId: course.academicYearId, sectionId: course.sectionId, subjectId: course.subjectId }, select: { id: true } }))
      : false;
    const mine = [v.selfStudentId, ...v.childIds].filter((x): x is string => !!x);
    const enrolled = mine.length
      ? await db.studentEnrollment.findMany({ where: { studentId: { in: mine }, sectionId: course.sectionId, academicYearId: course.academicYearId, status: 'enrolled' }, select: { studentId: true } })
      : [];
    const manage = v.isAdmin || teaches;
    if (!manage && enrolled.length === 0) throw new ForbiddenException('You do not have access to this course');
    return { course, manage, studentIds: enrolled.map((e) => e.studentId) };
  }

  private async assertManage(auth: Auth, courseId: string) {
    const { manage } = await this.courseAccess(auth, courseId);
    if (!manage) throw new ForbiddenException('Only the course teacher or an administrator can do this');
  }

  private async material(auth: Auth, id: string) {
    const m = await this.prisma.forSchool(auth.schoolId).courseMaterial.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Material not found');
    return m;
  }

  private async assignment(auth: Auth, id: string) {
    const a = await this.prisma.forSchool(auth.schoolId).assignment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }

  private async comment(auth: Auth, id: string) {
    const c = await this.prisma.forSchool(auth.schoolId).materialComment.findUnique({ where: { id }, include: { material: { select: { courseId: true } } } });
    if (!c || c.deletedAt) throw new NotFoundException('Comment not found');
    return c;
  }

  private async store(schoolId: string, file: Express.Multer.File) {
    if (file.size === 0) throw new BadRequestException('The file is empty');
    if (file.size > LMS_MAX_BYTES) throw new PayloadTooLargeException('Files must be at most 50 MB');
    const mimeType = detectAllowedType(file.originalname, file.buffer, LMS_TYPES);
    if (!mimeType) throw new BadRequestException('Only PDF, Word (.docx), JPG, PNG and MP4 files are allowed');
    const key = `${schoolId}/${randomUUID()}`;
    await this.storage.put(key, file.buffer);
    return { key, mimeType, fileName: safeFileName(file.originalname), size: file.size };
  }
}
