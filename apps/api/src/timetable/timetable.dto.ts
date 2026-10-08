import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SlotDto {
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsUUID() sectionId: string;
  @IsUUID() subjectId: string;
  @IsUUID() employeeId: string;
  @IsOptional() @IsUUID() roomId?: string | null;
  @IsInt() @Min(1) @Max(7) dayOfWeek: number;
  @Matches(HHMM, { message: 'startTime must be HH:MM (24h)' }) startTime: string;
  @Matches(HHMM, { message: 'endTime must be HH:MM (24h)' }) endTime: string;
}

/** Who can take a period: every current teacher, with their assignment and whether they are free. */
export class TeacherOptionsQuery {
  @IsUUID() sectionId: string;
  @IsUUID() subjectId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(7) dayOfWeek: number;
  @Matches(HHMM, { message: 'startTime must be HH:MM (24h)' }) startTime: string;
  @Matches(HHMM, { message: 'endTime must be HH:MM (24h)' }) endTime: string;
  /** When editing a period, that period itself does not count as a clash. */
  @IsOptional() @IsUUID() excludeSlotId?: string;
}

export class SectionTimetableQuery {
  @IsUUID() sectionId: string;
  @IsOptional() @IsUUID() academicYearId?: string;
}

export class TeacherTimetableQuery {
  @IsUUID() employeeId: string;
  @IsOptional() @IsUUID() academicYearId?: string;
}

export class StartSessionDto {
  @IsUUID() timetableSlotId: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value)) @IsString() @MaxLength(200) topic?: string | null;
}

export class MonitorQuery {
  @IsOptional() @IsDateOnly() date?: string;
}
