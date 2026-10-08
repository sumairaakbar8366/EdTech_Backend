import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasAccess } from '@schoolerp/shared';
import { formatDateOnly, toDateOnly } from '../common/date-only.js';
import { schoolClock } from '../common/school-time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import type { MarkAttendanceDto } from './attendance.dto.js';

type Auth = { schoolId: string; userId: string };

/** Page 7: "Teacher Marks Student Attendance" in a class session. */
@Injectable()
export class StudentAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The class roster for a session with any marks already taken. */
  async roster(auth: Auth, sessionId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const session = await this.loadSession(auth.schoolId, sessionId);
    await this.assertCanMark(auth, session, 'read');
    const yearId = session.timetableSlot?.academicYearId ?? (await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id;
    const enrollments = await db.studentEnrollment.findMany({
      where: { sectionId: session.sectionId, academicYearId: yearId, status: 'enrolled', student: { status: 'active' } },
      orderBy: [{ rollNo: 'asc' }, { student: { lastName: 'asc' } }],
      select: { rollNo: true, student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
    });
    const marks = await db.studentAttendance.findMany({ where: { sessionId } });
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    return {
      session,
      students: enrollments.map((e) => ({ ...e.student, rollNo: e.rollNo, mark: byStudent.get(e.student.id) ?? null })),
    };
  }

  /** Saves (or corrects) marks. Teachers: their own session, on the same school day. Admins: any time. */
  async mark(auth: Auth, sessionId: string, dto: MarkAttendanceDto) {
    const session = await this.loadSession(auth.schoolId, sessionId);
    const isAdmin = await this.assertCanMark(auth, session, 'write');
    if (session.status === 'cancelled') throw new BadRequestException('This class was cancelled');
    if (!isAdmin) {
      const tz = (await this.prisma.forSchool(auth.schoolId).schoolSettings.findUnique({ where: { schoolId: auth.schoolId }, select: { timezone: true } }))?.timezone ?? 'UTC';
      if (formatDateOnly(session.sessionDate) !== schoolClock(tz).date) {
        throw new ForbiddenException('Attendance can only be marked on the day of the class. Ask an administrator to correct it.');
      }
    }
    const ids = dto.records.map((r) => r.studentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each student can appear only once');

    const result = await this.prisma.inSchoolTransaction(auth.schoolId, async (tx) => {
      const yearId = session.timetableSlot?.academicYearId ?? (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id;
      const enrolled = await tx.studentEnrollment.count({ where: { sectionId: session.sectionId, academicYearId: yearId, studentId: { in: ids } } });
      if (enrolled !== ids.length) throw new BadRequestException('Some students are not enrolled in this section');
      const wasAbsent = new Set((await tx.studentAttendance.findMany({ where: { sessionId, status: 'absent' }, select: { studentId: true } })).map((x) => x.studentId));
      for (const r of dto.records) {
        await tx.studentAttendance.upsert({
          where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
          create: { schoolId: auth.schoolId, sessionId, studentId: r.studentId, status: r.status, remarks: r.remarks ?? null, markedBy: auth.userId },
          update: { status: r.status, remarks: r.remarks ?? null, markedBy: auth.userId, markedAt: new Date() },
        });
      }
      const counts = await tx.studentAttendance.groupBy({ by: ['status'], where: { sessionId }, _count: { _all: true } });
      const newlyAbsent = dto.records.filter((r) => r.status === 'absent' && !wasAbsent.has(r.studentId)).map((r) => r.studentId);
      return { counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), newlyAbsent };
    });
    // Page 11: "Student Absent → Parent" (in-app until SMS / WhatsApp providers are connected).
    if (result.newlyAbsent.length) {
      await this.notifications.notifyStudents(auth.schoolId, result.newlyAbsent, { guardians: true }, {
        eventType: 'student_absent',
        title: `Marked absent: ${session.subject.name}`,
        body: `${session.section.schoolClass.name} ${session.section.name} · ${formatDateOnly(session.sessionDate)}`,
        link: '/attendance',
      });
    }
    return result.counts;
  }

  /** Attendance summary for one student (own / children / staff with attendance access). */
  async studentSummary(auth: Auth, studentId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    await this.assertCanSeeStudent(auth, studentId);
    const [byStatus, recent] = await Promise.all([
      db.studentAttendance.groupBy({ by: ['status'], where: { studentId }, _count: { _all: true } }),
      db.studentAttendance.findMany({
        where: { studentId },
        orderBy: { markedAt: 'desc' },
        take: 30,
        select: { status: true, remarks: true, session: { select: { sessionDate: true, subject: { select: { name: true } } } } },
      }),
    ]);
    const counts = { present: 0, absent: 0, late: 0, excused: 0 } as Record<string, number>;
    for (const r of byStatus) counts[r.status] = r._count._all;
    const counted = counts.present! + counts.absent! + counts.late!;
    return {
      counts,
      // Excused absences are not held against the student.
      percentage: counted ? Math.round(((counts.present! + counts.late!) / counted) * 1000) / 10 : null,
      recent: recent.map((r) => ({ date: formatDateOnly(r.session.sessionDate), subject: r.session.subject.name, status: r.status, remarks: r.remarks })),
    };
  }

  /** Admin view of a section on a day: every session and its marks. */
  async sectionDay(schoolId: string, sectionId: string, date?: string) {
    const db = this.prisma.forSchool(schoolId);
    const tz = (await db.schoolSettings.findUnique({ where: { schoolId }, select: { timezone: true } }))?.timezone ?? 'UTC';
    const day = date ?? schoolClock(tz).date;
    const sessions = await db.classSession.findMany({
      where: { sectionId, sessionDate: toDateOnly(day) },
      orderBy: { startedAt: 'asc' },
      include: {
        subject: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
        attendance: { select: { status: true } },
      },
    });
    return {
      date: day,
      sessions: sessions.map((s) => ({
        id: s.id,
        subject: s.subject.name,
        teacher: `${s.employee.firstName} ${s.employee.lastName}`,
        status: s.status,
        startedAt: s.startedAt,
        counts: s.attendance.reduce<Record<string, number>>((m, a) => ({ ...m, [a.status]: (m[a.status] ?? 0) + 1 }), {}),
      })),
    };
  }

  private async loadSession(schoolId: string, id: string) {
    const session = await this.prisma.forSchool(schoolId).classSession.findUnique({
      where: { id },
      include: {
        timetableSlot: { select: { academicYearId: true } },
        subject: { select: { name: true } },
        section: { select: { name: true, schoolClass: { select: { name: true } } } },
        employee: { select: { id: true, userId: true, firstName: true, lastName: true } },
      },
    });
    if (!session) throw new NotFoundException('Class session not found');
    return session;
  }

  /** Returns true for admins (attendance:crud). Teachers may only handle their own sessions. */
  private async assertCanMark(auth: Auth, session: { employee: { userId: string | null } }, mode: 'read' | 'write'): Promise<boolean> {
    const perms = new Set((await this.permissions.loadUserAccess(auth.schoolId, auth.userId)).permissions);
    if (hasAccess(perms, 'attendance', ['crud'])) return true;
    if (mode === 'read' && hasAccess(perms, 'attendance', ['view'])) return true;
    if (hasAccess(perms, 'attendance', ['mark']) && session.employee.userId === auth.userId) return false;
    throw new ForbiddenException('This is not your class');
  }

  private async assertCanSeeStudent(auth: Auth, studentId: string): Promise<void> {
    const db = this.prisma.forSchool(auth.schoolId);
    const student = await db.student.findUnique({ where: { id: studentId }, select: { userId: true, guardians: { select: { guardian: { select: { userId: true } } } } } });
    if (!student) throw new NotFoundException('Student not found');
    const perms = new Set((await this.permissions.loadUserAccess(auth.schoolId, auth.userId)).permissions);
    if (hasAccess(perms, 'attendance', ['crud', 'view'])) return;
    if (hasAccess(perms, 'attendance', ['own']) && student.userId === auth.userId) return;
    if (hasAccess(perms, 'attendance', ['children']) && student.guardians.some((g) => g.guardian.userId === auth.userId)) return;
    if (hasAccess(perms, 'attendance', ['mark'])) {
      // Teachers: students in a section they teach this year.
      const teaches = await db.teacherAssignment.findFirst({
        where: { employee: { userId: auth.userId }, academicYear: { isCurrent: true }, section: { enrollments: { some: { studentId, academicYear: { isCurrent: true } } } } },
        select: { id: true },
      });
      if (teaches) return;
    }
    throw new ForbiddenException();
  }
}
