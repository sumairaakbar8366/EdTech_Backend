import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import { isoWeekday, schoolClock, toHHMM, toMinutes } from '../common/school-time.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type { SlotDto, TeacherOptionsQuery } from './timetable.dto.js';

const SLOT_INCLUDE = {
  subject: { select: { id: true, name: true, code: true } },
  employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true } },
  room: { select: { id: true, name: true } },
  section: { select: { id: true, name: true, schoolClass: { select: { id: true, name: true, level: true } }, campus: { select: { id: true, code: true } } } },
} as const;

type SlotRow = { startMinute: number; endMinute: number };
const withTimes = <T extends SlotRow>(s: T) => ({ ...s, startTime: toHHMM(s.startMinute), endTime: toHHMM(s.endMinute) });

/** Page 7: Timetable (planned schedule) → Class Session (actual class). */
@Injectable()
export class TimetableService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Timetable --------------------------------------------------------------------

  async sectionTimetable(schoolId: string, sectionId: string, academicYearId?: string) {
    const db = this.prisma.forSchool(schoolId);
    const yearId = await this.yearId(schoolId, academicYearId);
    const slots = await db.timetableSlot.findMany({
      where: { academicYearId: yearId, sectionId },
      include: SLOT_INCLUDE,
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
    return slots.map(withTimes);
  }

  async teacherTimetable(schoolId: string, employeeId: string, academicYearId?: string) {
    const db = this.prisma.forSchool(schoolId);
    const yearId = await this.yearId(schoolId, academicYearId);
    const slots = await db.timetableSlot.findMany({
      where: { academicYearId: yearId, employeeId },
      include: SLOT_INCLUDE,
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
    return slots.map(withTimes);
  }

  /** "My timetable": a teacher's teaching slots, or a student's section timetable. */
  async myTimetable(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const employee = await db.employee.findUnique({ where: { userId }, select: { id: true } });
    if (employee) return { kind: 'teacher' as const, slots: await this.teacherTimetable(schoolId, employee.id) };
    const student = await db.student.findUnique({ where: { userId }, select: { id: true } });
    if (student) {
      const yearId = await this.yearId(schoolId);
      const enrollment = await db.studentEnrollment.findUnique({ where: { studentId_academicYearId: { studentId: student.id, academicYearId: yearId } }, select: { sectionId: true } });
      return { kind: 'student' as const, slots: enrollment ? await this.sectionTimetable(schoolId, enrollment.sectionId, yearId) : [] };
    }
    throw new NotFoundException('No timetable is linked to your account');
  }

  /** A parent's children and each child's section timetable. */
  async childrenTimetables(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const yearId = await this.yearId(schoolId);
    const links = await db.studentGuardian.findMany({
      where: { guardian: { userId } },
      select: { student: { select: { id: true, firstName: true, lastName: true, enrollments: { where: { academicYearId: yearId }, select: { sectionId: true } } } } },
    });
    return Promise.all(
      links.map(async ({ student }) => ({
        studentId: student.id,
        name: `${student.firstName} ${student.lastName}`,
        slots: student.enrollments[0] ? await this.sectionTimetable(schoolId, student.enrollments[0].sectionId, yearId) : [],
      })),
    );
  }

  createSlot(schoolId: string, dto: SlotDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const yearId = await this.yearIdTx(tx, dto.academicYearId);
      const slot = await this.validateSlot(tx, schoolId, yearId, dto);
      const created = await tx.timetableSlot.create({ data: { schoolId, academicYearId: yearId, ...slot }, include: SLOT_INCLUDE });
      return withTimes(created);
    });
  }

  updateSlot(schoolId: string, id: string, dto: SlotDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const current = await tx.timetableSlot.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Timetable slot not found');
      const slot = await this.validateSlot(tx, schoolId, current.academicYearId, dto, id);
      const updated = await tx.timetableSlot.update({ where: { id }, data: slot, include: SLOT_INCLUDE });
      return withTimes(updated);
    });
  }

  /**
   * For the period form: every current teaching staff member, whether they are the section's teacher
   * for the subject (or teach it elsewhere), and what they are already teaching at that time, plus
   * anything the section itself already has then.
   */
  async teacherOptions(schoolId: string, q: TeacherOptionsQuery) {
    const db = this.prisma.forSchool(schoolId);
    const yearId = await this.yearId(schoolId);
    const startMinute = toMinutes(q.startTime);
    const endMinute = toMinutes(q.endTime);
    const section = await db.section.findUnique({ where: { id: q.sectionId }, select: { campusId: true } });
    if (!section) throw new NotFoundException('Section not found');
    const overlap = { academicYearId: yearId, dayOfWeek: q.dayOfWeek, startMinute: { lt: endMinute }, endMinute: { gt: startMinute }, ...(q.excludeSlotId && { id: { not: q.excludeSlotId } }) };
    const [teachers, assignments, busy, sectionBusy, load] = await Promise.all([
      db.employee.findMany({
        where: { staffType: 'teaching', status: { in: ['active', 'on_leave'] } },
        select: { id: true, firstName: true, lastName: true, employeeNo: true, status: true, campusId: true, campus: { select: { name: true } } },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      db.teacherAssignment.findMany({ where: { academicYearId: yearId, subjectId: q.subjectId }, select: { employeeId: true, sectionId: true } }),
      db.timetableSlot.findMany({ where: overlap, include: SLOT_INCLUDE }),
      db.timetableSlot.findFirst({ where: { ...overlap, sectionId: q.sectionId }, include: SLOT_INCLUDE }),
      db.timetableSlot.groupBy({ by: ['employeeId'], where: { academicYearId: yearId, dayOfWeek: q.dayOfWeek }, _count: true }),
    ]);
    const assigned = assignments.find((a) => a.sectionId === q.sectionId)?.employeeId ?? null;
    const label = (s: (typeof busy)[number]) => `${s.section.schoolClass.name}-${s.section.name} (${s.subject.name}, ${toHHMM(s.startMinute)}–${toHHMM(s.endMinute)})`;
    return {
      assignedEmployeeId: assigned,
      sectionBusy: sectionBusy ? `${sectionBusy.subject.name} (${toHHMM(sectionBusy.startMinute)}–${toHHMM(sectionBusy.endMinute)})` : null,
      teachers: teachers.map((t) => {
        const clash = busy.find((s) => s.employeeId === t.id);
        return {
          id: t.id,
          name: `${t.firstName} ${t.lastName}`,
          employeeNo: t.employeeNo,
          campus: t.campus.name,
          sameCampus: t.campusId === section.campusId,
          onLeave: t.status === 'on_leave',
          assigned: t.id === assigned,
          teachesSubject: assignments.some((a) => a.employeeId === t.id),
          periodsThatDay: load.find((l) => l.employeeId === t.id)?._count ?? 0,
          busyWith: clash ? label(clash) : null,
        };
      }),
    };
  }

  /**
   * Past class sessions (and their attendance) are kept, just detached from the slot. Done here
   * because the composite FK's ON DELETE SET NULL would also null school_id and fail.
   */
  removeSlot(schoolId: string, id: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      if (!(await tx.timetableSlot.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Timetable slot not found');
      await tx.classSession.updateMany({ where: { timetableSlotId: id }, data: { timetableSlotId: null } });
      await tx.timetableSlot.delete({ where: { id } });
    });
  }

  /**
   * Rules: the subject is taught in the section's class; the teacher is a current teaching staff
   * member (when the subject has no teacher in this section yet, they become its assigned teacher; a
   * different teacher may take single periods); the room is at the section's campus; and no overlap
   * for the section, teacher or room (also enforced by exclusion constraints).
   */
  private async validateSlot(tx: TenantTx, schoolId: string, academicYearId: string, dto: SlotDto, excludeId?: string) {
    const startMinute = toMinutes(dto.startTime);
    const endMinute = toMinutes(dto.endTime);
    if (endMinute <= startMinute) throw new BadRequestException('The period must end after it starts');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'timetable:' + schoolId + ':' + academicYearId}, 0))`;

    const section = await tx.section.findUnique({ where: { id: dto.sectionId }, select: { classId: true, campusId: true } });
    if (!section) throw new NotFoundException('Section not found');
    const taught = await tx.classSubject.findUnique({ where: { classId_subjectId: { classId: section.classId, subjectId: dto.subjectId } } });
    if (!taught) throw new BadRequestException('This subject is not taught in this class');
    const assignment = await tx.teacherAssignment.findUnique({
      where: { academicYearId_sectionId_subjectId: { academicYearId, sectionId: dto.sectionId, subjectId: dto.subjectId } },
      select: { employeeId: true },
    });
    const teacher = await tx.employee.findUnique({ where: { id: dto.employeeId }, select: { staffType: true, status: true } });
    if (!teacher) throw new NotFoundException('Teacher not found');
    if (teacher.staffType !== 'teaching') throw new BadRequestException('Only teaching staff can take a period');
    if (!['active', 'on_leave'].includes(teacher.status)) throw new BadRequestException('This teacher no longer works at the school');
    if (!assignment) await tx.teacherAssignment.create({ data: { schoolId, academicYearId, sectionId: dto.sectionId, subjectId: dto.subjectId, employeeId: dto.employeeId } });
    if (dto.roomId) {
      const room = await tx.room.findUnique({ where: { id: dto.roomId }, select: { campusId: true } });
      if (!room) throw new NotFoundException('Room not found');
      if (room.campusId !== section.campusId) throw new BadRequestException('The room must be at the same campus as the section');
    }

    const overlapping = (extra: object) =>
      tx.timetableSlot.findFirst({
        where: { academicYearId, dayOfWeek: dto.dayOfWeek, startMinute: { lt: endMinute }, endMinute: { gt: startMinute }, ...(excludeId && { id: { not: excludeId } }), ...extra },
        include: SLOT_INCLUDE,
      });
    const clashSection = await overlapping({ sectionId: dto.sectionId });
    if (clashSection) throw new ConflictException(`The section already has ${clashSection.subject.name} at ${toHHMM(clashSection.startMinute)}–${toHHMM(clashSection.endMinute)}`);
    const clashTeacher = await overlapping({ employeeId: dto.employeeId });
    if (clashTeacher) {
      throw new ConflictException(`${clashTeacher.employee.firstName} ${clashTeacher.employee.lastName} is already teaching ${clashTeacher.section.schoolClass.name}-${clashTeacher.section.name} at ${toHHMM(clashTeacher.startMinute)}–${toHHMM(clashTeacher.endMinute)}`);
    }
    if (dto.roomId) {
      const clashRoom = await overlapping({ roomId: dto.roomId });
      if (clashRoom) throw new ConflictException(`${clashRoom.room?.name} is booked at ${toHHMM(clashRoom.startMinute)}–${toHHMM(clashRoom.endMinute)}`);
    }
    return { sectionId: dto.sectionId, subjectId: dto.subjectId, employeeId: dto.employeeId, roomId: dto.roomId ?? null, dayOfWeek: dto.dayOfWeek, startMinute, endMinute };
  }

  // --- Class sessions -------------------------------------------------------------------

  /** Today's periods for the signed-in teacher, with the state of each class. */
  async teacherToday(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const employee = await db.employee.findUnique({ where: { userId }, select: { id: true } });
    if (!employee) throw new NotFoundException('No staff record is linked to your account');
    const clock = await this.clock(schoolId);
    const yearId = await this.yearId(schoolId);
    const slots = await db.timetableSlot.findMany({
      where: { academicYearId: yearId, employeeId: employee.id, dayOfWeek: clock.dayOfWeek },
      include: { ...SLOT_INCLUDE, sessions: { where: { sessionDate: toDateOnly(clock.date) } } },
      orderBy: { startMinute: 'asc' },
    });
    return { date: clock.date, nowMinute: clock.minute, slots: slots.map((s) => ({ ...withTimes(s), session: s.sessions[0] ?? null, sessions: undefined })) };
  }

  /** Teacher presses "Start Class" (page 7): creates the actual class session for today. */
  startSession(schoolId: string, userId: string, timetableSlotId: string, topic?: string | null) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await tx.employee.findUnique({ where: { userId }, select: { id: true, status: true } });
      if (!employee) throw new NotFoundException('No staff record is linked to your account');
      if (employee.status !== 'active') throw new ForbiddenException('Only active staff can start classes');
      const slot = await tx.timetableSlot.findUnique({ where: { id: timetableSlotId } });
      if (!slot) throw new NotFoundException('Timetable slot not found');
      if (slot.employeeId !== employee.id) throw new ForbiddenException('This class is not on your timetable');

      const clock = await this.clockTx(tx, schoolId);
      if (slot.dayOfWeek !== clock.dayOfWeek) throw new BadRequestException('This class is not scheduled for today');
      const live = await tx.classSession.findFirst({ where: { employeeId: employee.id, status: 'live' }, select: { id: true } });
      if (live) throw new ConflictException('End your current class before starting another one');
      const existing = await tx.classSession.findUnique({ where: { timetableSlotId_sessionDate: { timetableSlotId, sessionDate: toDateOnly(clock.date) } } });
      if (existing) throw new ConflictException(existing.status === 'live' ? 'This class is already live' : 'This class has already been held today');

      return tx.classSession.create({
        data: {
          schoolId,
          timetableSlotId,
          sectionId: slot.sectionId,
          subjectId: slot.subjectId,
          employeeId: employee.id,
          sessionDate: toDateOnly(clock.date),
          startedAt: new Date(),
          topic: topic ?? null,
        },
      });
    });
  }

  /** Teacher ends the class (page 7: "Teacher Ends Class → Class Session Completed"). */
  endSession(schoolId: string, userId: string, sessionId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await tx.employee.findUnique({ where: { userId }, select: { id: true } });
      const session = await tx.classSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException('Class session not found');
      if (!employee || session.employeeId !== employee.id) throw new ForbiddenException('This is not your class');
      if (session.status !== 'live') throw new BadRequestException('This class is not live');
      return tx.classSession.update({ where: { id: sessionId }, data: { status: 'completed', endedAt: new Date() } });
    });
  }

  /**
   * Admin monitoring (page 7 "Admin Reporting Views"): every period of a day with its state:
   * scheduled, live, completed, missed (period over and never started), and lateness.
   */
  async monitor(schoolId: string, date?: string) {
    const db = this.prisma.forSchool(schoolId);
    const timeZone = await this.timeZone(schoolId);
    const clock = schoolClock(timeZone);
    const day = date ?? clock.date;
    const dayOfWeek = isoWeekday(day);
    const yearId = await this.yearId(schoolId);
    const slots = await db.timetableSlot.findMany({
      where: { academicYearId: yearId, dayOfWeek },
      include: { ...SLOT_INCLUDE, sessions: { where: { sessionDate: toDateOnly(day) } } },
      orderBy: [{ startMinute: 'asc' }],
    });
    const isToday = day === clock.date;
    const isPast = day < clock.date;
    const rows = slots.map((s) => {
      const session = s.sessions[0] ?? null;
      const state = session
        ? session.status
        : isPast || (isToday && clock.minute >= s.endMinute)
          ? 'missed'
          : 'scheduled';
      const startedLateBy = session ? Math.max(0, schoolClock(timeZone, session.startedAt).minute - s.startMinute) : null;
      return { ...withTimes(s), sessions: undefined, session, state, startedLateBy };
    });
    const count = (st: string) => rows.filter((r) => r.state === st).length;
    return {
      date: day,
      dayOfWeek,
      totals: { scheduled: rows.length, live: count('live'), completed: count('completed'), missed: count('missed'), upcoming: count('scheduled') },
      rows,
    };
  }

  // --- helpers ----------------------------------------------------------------------

  private async yearId(schoolId: string, academicYearId?: string): Promise<string> {
    return this.prisma.inSchoolTransaction(schoolId, (tx) => this.yearIdTx(tx, academicYearId));
  }

  private async yearIdTx(tx: TenantTx, academicYearId?: string): Promise<string> {
    const year = academicYearId
      ? await tx.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true } })
      : await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year) throw new BadRequestException(academicYearId ? 'Academic year not found' : 'Set a current academic year first');
    return year.id;
  }

  private async clock(schoolId: string) {
    return schoolClock(await this.timeZone(schoolId));
  }

  private async timeZone(schoolId: string): Promise<string> {
    const settings = await this.prisma.forSchool(schoolId).schoolSettings.findUnique({ where: { schoolId }, select: { timezone: true } });
    return settings?.timezone ?? 'UTC';
  }

  private async clockTx(tx: TenantTx, schoolId: string) {
    const settings = await tx.schoolSettings.findUnique({ where: { schoolId }, select: { timezone: true } });
    return schoolClock(settings?.timezone ?? 'UTC');
  }
}
