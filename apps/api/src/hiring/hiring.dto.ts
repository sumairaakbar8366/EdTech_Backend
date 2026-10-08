import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { EMPLOYMENT_TYPES, STAFF_TYPES, StaffLoginDto } from '../staff/staff.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const POST_STATUSES = ['draft', 'open', 'closed'] as const;
export const APPLICATION_STATUSES = ['applied', 'shortlisted', 'interview', 'selected', 'hired', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Allowed manual moves. "hired" is only reachable through the hire action. */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  applied: ['shortlisted', 'rejected', 'withdrawn'],
  shortlisted: ['interview', 'rejected', 'withdrawn'],
  interview: ['selected', 'rejected', 'withdrawn'],
  selected: ['rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

export class CreateJobPostDto {
  @IsUUID() campusId: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) title: string;
  @IsIn(STAFF_TYPES) staffType: (typeof STAFF_TYPES)[number];
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(100) department?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(500) openings?: number;
  @IsOptional() @IsIn(POST_STATUSES) status?: (typeof POST_STATUSES)[number];
  @IsOptional() @IsDateOnly() closingDate?: string | null;
}

export class UpdateJobPostDto {
  @IsOptional() @IsUUID() campusId?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) title?: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(100) department?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(500) openings?: number;
  @IsOptional() @IsIn(POST_STATUSES) status?: (typeof POST_STATUSES)[number];
  @IsOptional() @IsDateOnly() closingDate?: string | null;
}

export class ApplicationDetailsDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) email: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) education?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(60) experienceYears?: number | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) experience?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) previousSchools?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) references?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) coverNote?: string | null;
}

export class MoveApplicationDto {
  @IsIn(APPLICATION_STATUSES) status: ApplicationStatus;
}

export class ScheduleInterviewDto {
  @IsISO8601({ strict: true }) scheduledAt: string;
  @IsOptional() @IsIn(['in_person', 'online', 'phone']) mode?: 'in_person' | 'online' | 'phone';
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) interviewer: string;
}

export class InterviewResultDto {
  @IsOptional() @IsInt() @Min(1) @Max(10) score?: number | null;
  @IsOptional() @IsIn(['strong_yes', 'yes', 'no', 'strong_no']) recommendation?: 'strong_yes' | 'yes' | 'no' | 'strong_no' | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) notes?: string | null;
}

export class HireDto {
  @IsDateOnly() joinDate: string;
  @IsOptional() @IsUUID() campusId?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) designation?: string;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES) employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @ValidateNested() @Type(() => StaffLoginDto) login?: StaffLoginDto;
}
