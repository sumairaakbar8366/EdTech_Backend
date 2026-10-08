import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';

const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// --- Student attendance -------------------------------------------------------------

export class AttendanceRecordDto {
  @IsUUID() studentId: string;
  @IsIn(['present', 'absent', 'late', 'excused']) status: 'present' | 'absent' | 'late' | 'excused';
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(200) remarks?: string | null;
}

export class MarkAttendanceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AttendanceRecordDto) records: AttendanceRecordDto[];
}

export class SectionDayQuery {
  @IsUUID() sectionId: string;
  @IsOptional() @IsDateOnly() date?: string;
}

// --- Staff attendance & geofences ---------------------------------------------------

export class CheckInDto {
  @IsOptional() @IsLatitude() latitude?: number | null;
  @IsOptional() @IsLongitude() longitude?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) accuracyMeters?: number | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) deviceId?: string | null;
}

export class GeofenceDto {
  @IsLatitude() centerLatitude: number;
  @IsLongitude() centerLongitude: number;
  @IsInt() @Min(10) @Max(10_000) radiusMeters: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class StaffAttendanceQuery {
  @IsOptional() @IsDateOnly() date?: string;
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) reviewStatus?: 'pending' | 'approved' | 'rejected';
}

export class MonthQuery {
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' }) month?: string;
}

export class ReviewDto {
  @IsIn(['approved', 'rejected']) decision: 'approved' | 'rejected';
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) note?: string | null;
}

// --- Leave --------------------------------------------------------------------------

export class LeaveTypeDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) name: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z0-9-]{1,10}$/, { message: 'code must be 1–10 letters, digits or hyphens' }) code: string;
  @IsOptional() @IsInt() @Min(0) @Max(366) annualQuota?: number | null;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ApplyLeaveDto {
  @IsUUID() leaveTypeId: string;
  @IsDateOnly() startDate: string;
  @IsDateOnly() endDate: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reason: string;
}

export class DecideLeaveDto {
  @IsIn(['approved', 'rejected']) decision: 'approved' | 'rejected';
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) note?: string | null;
}

export class LeaveListQuery {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected', 'cancelled']) status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
}

export class WeeklyOffDaysDto {
  @IsArray() @ArrayMaxSize(6) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) weeklyOffDays: number[];
}
