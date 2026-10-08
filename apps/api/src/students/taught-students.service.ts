import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Teacher "My Students": the sections a teacher teaches this year, with each student's attendance rate. */
@Injectable()
export class TaughtStudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async forTeacher(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [employee, year] = await Promise.all([
      db.employee.findUnique({ where: { userId }, select: { id: true } }),
      db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }),
    ]);
    if (!employee || !year) return [];
    const assignments = await db.teacherAssignment.findMany({
      where: { employeeId: employee.id, academicYearId: year.id },
      select: { sectionId: true, subject: { select: { name: true } }, section: { select: { name: true, schoolClass: { select: { name: true, level: true } } } } },
    });
    const sections = new Map<string, { sectionId: string; name: string; level: number; subjects: string[] }>();
    for (const a of assignments) {
      const s = sections.get(a.sectionId) ?? { sectionId: a.sectionId, name: `${a.section.schoolClass.name} ${a.section.name}`, level: a.section.schoolClass.level, subjects: [] };
      s.subjects.push(a.subject.name);
      sections.set(a.sectionId, s);
    }
    if (sections.size === 0) return [];
    const enrolments = await db.studentEnrollment.findMany({
      where: { academicYearId: year.id, status: 'enrolled', sectionId: { in: [...sections.keys()] } },
      select: { sectionId: true, rollNo: true, student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, gender: true } } },
      orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
    });
    const ids = enrolments.map((e) => e.student.id);
    const marks = ids.length
      ? await db.studentAttendance.groupBy({ by: ['studentId', 'status'], where: { studentId: { in: ids }, session: { sectionId: { in: [...sections.keys()] } } }, _count: { _all: true } })
      : [];
    const rate = (id: string) => {
      const rows = marks.filter((m) => m.studentId === id);
      const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
      const counted = n('present') + n('late') + n('absent');
      return counted ? Math.round(((n('present') + n('late')) / counted) * 1000) / 10 : null;
    };
    return [...sections.values()]
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .map((s) => ({
        ...s,
        students: enrolments.filter((e) => e.sectionId === s.sectionId).map((e) => ({ ...e.student, rollNo: e.rollNo, attendanceRate: rate(e.student.id) })),
      }));
  }
}
