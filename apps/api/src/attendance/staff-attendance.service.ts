import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import { schoolClock } from '../common/school-time.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type { CheckInDto, GeofenceDto, ReviewDto, StaffAttendanceQuery } from './attendance.dto.js';
import { evaluateGeofence } from './geo.js';

const RECORD_SELECT = {
  id: true,
  date: true,
  checkInAt: true,
  checkOutAt: true,
  latitude: true,
  longitude: true,
  accuracyMeters: true,
  distanceMeters: true,
  geofenceStatus: true,
  deviceId: true,
  reviewStatus: true,
  reviewNote: true,
  reviewedAt: true,
} as const;

/** Page 7 "Teacher Attendance — GPS Geofencing Validation Engine". */
@Injectable()
export class StaffAttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Geofences (per campus) ---------------------------------------------------------

  listGeofences(schoolId: string) {
    return this.prisma.forSchool(schoolId).campus.findMany({
      where: { isActive: true },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, geofences: { where: { isActive: true }, select: { id: true, centerLatitude: true, centerLongitude: true, radiusMeters: true, updatedAt: true } } },
    });
  }

  /** Sets the campus geofence (replaces the active one). */
  setGeofence(schoolId: string, campusId: string, dto: GeofenceDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const campus = await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } });
      if (!campus) throw new NotFoundException('Campus not found');
      await tx.campusGeofence.updateMany({ where: { campusId, isActive: true }, data: { isActive: false } });
      if (dto.isActive === false) return null;
      return tx.campusGeofence.create({
        data: { schoolId, campusId, centerLatitude: dto.centerLatitude, centerLongitude: dto.centerLongitude, radiusMeters: dto.radiusMeters, createdBy: actorUserId },
      });
    });
  }

  // --- Check in / out -----------------------------------------------------------------

  checkIn(schoolId: string, userId: string, dto: CheckInDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await this.ownEmployee(tx, userId);
      const clock = await clockFor(tx, schoolId);
      const date = toDateOnly(clock.date);
      if (await tx.staffAttendance.findUnique({ where: { employeeId_date: { employeeId: employee.id, date } }, select: { id: true } })) {
        throw new ConflictException('You have already checked in today');
      }
      const hasFix = dto.latitude != null && dto.longitude != null;
      const fence = await tx.campusGeofence.findFirst({ where: { campusId: employee.campusId, isActive: true } });
      const result = evaluateGeofence(
        hasFix ? { latitude: dto.latitude!, longitude: dto.longitude! } : null,
        fence ? { latitude: Number(fence.centerLatitude), longitude: Number(fence.centerLongitude), radiusMeters: fence.radiusMeters } : null,
      );
      return tx.staffAttendance.create({
        data: {
          schoolId,
          employeeId: employee.id,
          date,
          checkInAt: new Date(),
          latitude: hasFix ? dto.latitude : null,
          longitude: hasFix ? dto.longitude : null,
          accuracyMeters: dto.accuracyMeters ?? null,
          distanceMeters: result.distance,
          geofenceStatus: result.status,
          deviceId: dto.deviceId ?? null,
          reviewStatus: result.status === 'valid' ? null : 'pending',
        },
        select: RECORD_SELECT,
      });
    });
  }

  checkOut(schoolId: string, userId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await this.ownEmployee(tx, userId);
      const clock = await clockFor(tx, schoolId);
      const record = await tx.staffAttendance.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: toDateOnly(clock.date) } } });
      if (!record) throw new BadRequestException('Check in first');
      if (record.checkOutAt) throw new ConflictException('You have already checked out today');
      return tx.staffAttendance.update({ where: { id: record.id }, data: { checkOutAt: new Date() }, select: RECORD_SELECT });
    });
  }

  /** Own attendance for a month, plus today's record. */
  async mine(schoolId: string, userId: string, month?: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const employee = await this.ownEmployee(tx, userId);
      const clock = await clockFor(tx, schoolId);
      const [y, m] = (month ?? clock.date.slice(0, 7)).split('-').map(Number) as [number, number];
      const from = new Date(Date.UTC(y, m - 1, 1));
      const to = new Date(Date.UTC(y, m, 0));
      const records = await tx.staffAttendance.findMany({ where: { employeeId: employee.id, date: { gte: from, lte: to } }, orderBy: { date: 'desc' }, select: RECORD_SELECT });
      const today = await tx.staffAttendance.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: toDateOnly(clock.date) } }, select: RECORD_SELECT });
      const fence = await tx.campusGeofence.findFirst({ where: { campusId: employee.campusId, isActive: true }, select: { radiusMeters: true } });
      return {
        today,
        date: clock.date,
        geofenceConfigured: !!fence,
        records,
        summary: {
          present: records.filter((r) => r.geofenceStatus === 'valid' || r.reviewStatus === 'approved').length,
          pendingReview: records.filter((r) => r.reviewStatus === 'pending').length,
          rejected: records.filter((r) => r.reviewStatus === 'rejected').length,
        },
      };
    });
  }

  // --- Admin --------------------------------------------------------------------------

  async list(schoolId: string, q: StaffAttendanceQuery) {
    const db = this.prisma.forSchool(schoolId);
    const tz = (await db.schoolSettings.findUnique({ where: { schoolId }, select: { timezone: true } }))?.timezone ?? 'UTC';
    const day = q.date ?? schoolClock(tz).date;
    const where = q.reviewStatus ? { reviewStatus: q.reviewStatus } : { date: toDateOnly(day) };
    const [records, staffCount] = await Promise.all([
      db.staffAttendance.findMany({
        where,
        orderBy: [{ date: 'desc' }, { checkInAt: 'asc' }],
        take: 500,
        select: { ...RECORD_SELECT, employee: { select: { id: true, firstName: true, lastName: true, employeeNo: true, designation: true, campus: { select: { name: true, code: true } } } } },
      }),
      db.employee.count({ where: { status: 'active' } }),
    ]);
    return {
      date: q.reviewStatus ? null : day,
      totals: {
        activeStaff: staffCount,
        checkedIn: records.length,
        valid: records.filter((r) => r.geofenceStatus === 'valid').length,
        flagged: records.filter((r) => r.geofenceStatus === 'flagged').length,
        unknown: records.filter((r) => r.geofenceStatus === 'unknown').length,
        pendingReview: records.filter((r) => r.reviewStatus === 'pending').length,
      },
      records,
    };
  }

  /** Admin decision on a flagged/unknown check-in. */
  review(schoolId: string, id: string, dto: ReviewDto, actorUserId: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const record = await tx.staffAttendance.findUnique({ where: { id }, select: { reviewStatus: true, employee: { select: { userId: true } } } });
      if (!record) throw new NotFoundException('Attendance record not found');
      if (record.reviewStatus === null) throw new BadRequestException('This check-in was inside the geofence and needs no review');
      if (record.employee.userId === actorUserId) throw new ForbiddenException('You cannot review your own attendance');
      return tx.staffAttendance.update({
        where: { id },
        data: { reviewStatus: dto.decision, reviewNote: dto.note ?? null, reviewedBy: actorUserId, reviewedAt: new Date() },
        select: RECORD_SELECT,
      });
    });
  }

  private async ownEmployee(tx: TenantTx, userId: string) {
    const employee = await tx.employee.findUnique({ where: { userId }, select: { id: true, campusId: true, status: true } });
    if (!employee) throw new NotFoundException('No staff record is linked to your account');
    if (employee.status !== 'active') throw new ForbiddenException('Only active staff can record attendance');
    return employee;
  }
}

async function clockFor(tx: TenantTx, schoolId: string) {
  const s = await tx.schoolSettings.findUnique({ where: { schoolId }, select: { timezone: true } });
  return schoolClock(s?.timezone ?? 'UTC');
}
