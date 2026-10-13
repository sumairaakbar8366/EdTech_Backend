import 'reflect-metadata';
import './no-jobs.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Development only: backfills past class sessions, student attendance and staff check-ins for the
 * demo school from its timetable, so attendance screens and reports have history. The live API only
 * records "today", which is why this goes through Prisma (still inside the tenant's RLS context).
 *
 *   npm run db:seed:demo-attendance -w @schoolerp/api   (FROM=2026-09-01, default: 30 days back)
 *
 * Idempotent: days that already have sessions or check-ins are skipped.
 */
const DAY = 86_400_000;

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
/** ISO weekday, 1 = Monday ... 7 = Sunday. */
const isoDay = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;
/** Stable 0..1 number from a string, so re-runs and related rows agree. */
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Minutes the zone is ahead of UTC at that instant (e.g. Asia/Karachi = 300). */
function tzOffset(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at).map((p) => [p.type, p.value]));
  const local = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!);
  return Math.round((local - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

async function run() {
  const logger = new Logger('DemoAttendance');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const prisma = app.get(PrismaService);
    const school = await prisma.school.findUnique({ where: { slug: process.env.SCHOOL ?? 'demo' }, select: { id: true } });
    if (!school) throw new Error('Demo school not found');
    // Read inside the tenant context: row-level security hides other rows.
    const tz = (await prisma.inSchoolTransaction(school.id, (tx) => tx.schoolSettings.findUnique({ where: { schoolId: school.id }, select: { timezone: true } })))?.timezone ?? 'UTC';
    const now = new Date();
    const nowOffset = tzOffset(tz, now);
    const localNow = new Date(now.getTime() + nowOffset * 60_000);
    const today = dateOnly(localNow);
    const nowMinute = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
    /** The instant of a school-local minute on a school-local date. */
    const at = (d: Date, minute: number) => new Date(d.getTime() + (minute - tzOffset(tz, new Date(d.getTime() + 12 * 3_600_000))) * 60_000);
    const from = process.env.FROM ? dateOnly(new Date(`${process.env.FROM}T00:00:00Z`)) : new Date(today.getTime() - 30 * DAY);

    const result = await prisma.inSchoolTransaction(
      school.id,
      async (tx) => {
        const settings = await tx.schoolSettings.findUnique({ where: { schoolId: school.id } });
        const offDays = new Set(settings?.weeklyOffDays ?? [6, 7]);
        const year = await tx.academicYear.findFirst({ where: { isCurrent: true } });
        if (!year) throw new Error('No current academic year');
        const slots = await tx.timetableSlot.findMany({ where: { academicYearId: year.id }, include: { employee: { select: { userId: true } } } });
        const enrollments = await tx.studentEnrollment.findMany({ where: { academicYearId: year.id, status: 'enrolled' }, select: { studentId: true, sectionId: true } });
        const bySection = new Map<string, string[]>();
        for (const e of enrollments) bySection.set(e.sectionId, [...(bySection.get(e.sectionId) ?? []), e.studentId]);
        const leave = await tx.leaveRequest.findMany({ where: { status: 'approved' }, select: { employeeId: true, startDate: true, endDate: true } });
        const onLeave = (employeeId: string, d: Date) => leave.some((l) => l.employeeId === employeeId && l.startDate <= d && l.endDate >= d);
        const staff = await tx.employee.findMany({ where: { status: 'active' }, select: { id: true } });

        let sessions = 0;
        let marks = 0;
        let checkIns = 0;
        let retimed = 0;

        // Earlier runs (before the school had its real time zone) wrote UTC clock times: correct them.
        const past = await tx.classSession.findMany({ where: { sessionDate: { gte: from, lte: today }, status: 'completed', timetableSlotId: { not: null } }, include: { timetableSlot: true } });
        for (const ses of past) {
          const slot = ses.timetableSlot!;
          const expected = at(ses.sessionDate, slot.startMinute);
          if (Math.abs(ses.startedAt.getTime() - expected.getTime()) > 60 * 60_000) {
            await tx.classSession.update({ where: { id: ses.id }, data: { startedAt: new Date(expected.getTime() + 2 * 60_000), endedAt: at(ses.sessionDate, slot.endMinute) } });
            retimed++;
          }
        }
        // Rows without a location were written by this tool (real check-ins carry coordinates).
        const pastStaff = await tx.staffAttendance.findMany({ where: { date: { gte: from, lte: today }, latitude: null } });
        for (const r of pastStaff) {
          const inLocal = (r.checkInAt.getTime() - r.date.getTime()) / 60_000 + tzOffset(tz, r.checkInAt);
          if (inLocal > 11 * 60) {
            const key = r.date.toISOString().slice(0, 10);
            await tx.staffAttendance.update({
              where: { id: r.id },
              data: { checkInAt: at(r.date, 7 * 60 + 40 + Math.round(unit(`${r.employeeId}${key}in`) * 32)), checkOutAt: at(r.date, 13 * 60 + 30 + Math.round(unit(`${r.employeeId}${key}out`) * 60)) },
            });
            retimed++;
          }
        }

        for (let d = from; d <= today; d = new Date(d.getTime() + DAY)) {
          const isToday = d.getTime() === today.getTime();
          if (offDays.has(isoDay(d))) continue;
          const key = d.toISOString().slice(0, 10);

          // Class sessions + attendance for every slot scheduled that weekday.
          for (const slot of slots.filter((s) => s.dayOfWeek === isoDay(d) && (!isToday || s.endMinute <= nowMinute))) {
            const exists = await tx.classSession.findUnique({ where: { timetableSlotId_sessionDate: { timetableSlotId: slot.id, sessionDate: d } }, select: { id: true } });
            if (exists) continue;
            const startedAt = new Date(at(d, slot.startMinute).getTime() + Math.round(unit(`${slot.id}${key}s`) * 4) * 60_000);
            const session = await tx.classSession.create({
              data: {
                schoolId: school.id,
                timetableSlotId: slot.id,
                sectionId: slot.sectionId,
                subjectId: slot.subjectId,
                employeeId: slot.employeeId,
                sessionDate: d,
                startedAt,
                endedAt: at(d, slot.endMinute),
                status: 'completed',
              },
            });
            sessions++;
            const roster = bySection.get(slot.sectionId) ?? [];
            if (!roster.length) continue;
            await tx.studentAttendance.createMany({
              data: roster.map((studentId) => {
                // Absence is per day (the same for all periods); a few students are absent more often.
                const proneness = unit(studentId) < 0.12 ? 0.12 : 0.03;
                const r = unit(`${studentId}${key}`);
                const late = unit(`${studentId}${key}${slot.startMinute}`) < 0.025 && slot.startMinute === 480;
                const status = r < proneness ? (r < proneness * 0.25 ? 'excused' : 'absent') : late ? 'late' : 'present';
                return { schoolId: school.id, sessionId: session.id, studentId, status, markedBy: slot.employee.userId, markedAt: new Date(startedAt.getTime() + 5 * 60_000) };
              }),
              skipDuplicates: true,
            });
            marks += roster.length;
          }

          // Staff check-ins (the API records "now" only).
          for (const e of staff) {
            if (onLeave(e.id, d) || unit(`${e.id}${key}`) < 0.03) continue;
            const inMin = 7 * 60 + 40 + Math.round(unit(`${e.id}${key}in`) * 32);
            const outMin = 13 * 60 + 30 + Math.round(unit(`${e.id}${key}out`) * 60);
            if (isToday && nowMinute < inMin) continue;
            const flagged = unit(`${e.id}${key}geo`) < 0.04;
            const res = await tx.staffAttendance.createMany({
              data: [{
                schoolId: school.id,
                employeeId: e.id,
                date: d,
                checkInAt: at(d, inMin),
                checkOutAt: isToday && nowMinute < outMin ? null : at(d, outMin),
                geofenceStatus: flagged ? 'flagged' : 'valid',
                reviewStatus: flagged ? (d.getTime() > today.getTime() - 5 * DAY ? 'pending' : 'approved') : null,
              }],
              skipDuplicates: true,
            });
            checkIns += res.count;
          }
        }
        return { sessions, marks, checkIns, retimed };
      },
      { timeout: 600_000 },
    );
    logger.log(`Backfilled from ${from.toISOString().slice(0, 10)}: ${result.sessions} class sessions, ${result.marks} attendance marks, ${result.checkIns} staff check-ins, ${result.retimed} earlier rows moved to ${tz} time`);
  } finally {
    await app.close();
  }
}

await run();
