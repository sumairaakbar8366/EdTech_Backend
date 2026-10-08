import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssignTeacherDto, ListAssignmentsQuery } from './staff.dto.js';

const INCLUDE = {
  academicYear: { select: { id: true, name: true, isCurrent: true } },
  subject: { select: { id: true, name: true, code: true } },
  section: {
    select: { id: true, name: true, schoolClass: { select: { id: true, name: true, level: true } }, campus: { select: { id: true, name: true, code: true } } },
  },
  employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true } },
} as const;

/** Page 10 "Teacher Assignment": one teacher per subject, per section, per academic year. */
@Injectable()
export class TeacherAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string, q: ListAssignmentsQuery) {
    const db = this.prisma.forSchool(schoolId);
    const academicYearId = q.academicYearId ?? (await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id;
    if (!academicYearId) return [];
    return db.teacherAssignment.findMany({
      where: { academicYearId, sectionId: q.sectionId, employeeId: q.employeeId },
      include: INCLUDE,
      orderBy: [{ section: { schoolClass: { level: 'asc' } } }, { section: { name: 'asc' } }, { subject: { name: 'asc' } }],
    });
  }

  /** Assigns, or reassigns, the teacher for a subject in a section. */
  assign(schoolId: string, dto: AssignTeacherDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const year = dto.academicYearId
        ? await tx.academicYear.findUnique({ where: { id: dto.academicYearId }, select: { id: true } })
        : await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!year) throw new BadRequestException(dto.academicYearId ? 'Academic year not found' : 'Set a current academic year first');

      const section = await tx.section.findUnique({ where: { id: dto.sectionId }, select: { classId: true } });
      if (!section) throw new NotFoundException('Section not found');

      const taught = await tx.classSubject.findUnique({
        where: { classId_subjectId: { classId: section.classId, subjectId: dto.subjectId } },
        select: { subjectId: true },
      });
      if (!taught) throw new BadRequestException('This subject is not taught in this class. Add it to the class first.');

      const teacher = await tx.employee.findUnique({ where: { id: dto.employeeId }, select: { staffType: true, status: true } });
      if (!teacher) throw new NotFoundException('Staff member not found');
      if (teacher.staffType !== 'teaching') throw new BadRequestException('Only teaching staff can be assigned to a subject');
      if (teacher.status !== 'active') throw new BadRequestException('Only active teachers can be assigned');

      return tx.teacherAssignment.upsert({
        where: {
          academicYearId_sectionId_subjectId: { academicYearId: year.id, sectionId: dto.sectionId, subjectId: dto.subjectId },
        },
        create: { schoolId, academicYearId: year.id, sectionId: dto.sectionId, subjectId: dto.subjectId, employeeId: dto.employeeId },
        update: { employeeId: dto.employeeId },
        include: INCLUDE,
      });
    });
  }

  async remove(schoolId: string, id: string) {
    const { count } = await this.prisma.forSchool(schoolId).teacherAssignment.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Assignment not found');
  }
}
