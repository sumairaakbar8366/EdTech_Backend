import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested, IsBoolean } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';
import { GENDERS, LoginPasswordDto, RELATIONS, StudentLoginDto, type Relation } from '../students/students.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Names and phone numbers are stored without doubled or stray spaces. */
const tidy = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const ADMISSION_STATUSES = [
  'submitted',
  'documents_verified',
  'interview_scheduled',
  'under_review',
  'approved',
  'rejected',
  'enrolled',
  'withdrawn',
] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

/** Page 5 flow. "enrolled" is only reachable through the enroll action. */
export const ADMISSION_TRANSITIONS: Record<AdmissionStatus, readonly AdmissionStatus[]> = {
  submitted: ['documents_verified', 'rejected', 'withdrawn'],
  documents_verified: ['interview_scheduled', 'under_review', 'rejected', 'withdrawn'],
  interview_scheduled: ['under_review', 'rejected', 'withdrawn'],
  under_review: ['approved', 'rejected'],
  approved: ['withdrawn'],
  rejected: [],
  enrolled: [],
  withdrawn: [],
};

export class ApplicationDto {
  /** The applicant's picture, uploaded first (POST /photos/upload or /public/photos). Required on the website form. */
  @IsOptional() @IsUUID() photoId?: string;
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsUUID() classId: string;
  @IsUUID() campusId: string;
  @Transform(tidy) @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @Transform(tidy) @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  @IsOptional() @IsIn(GENDERS) gender?: (typeof GENDERS)[number] | null;
  @IsDateOnly() dateOfBirth: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value)) @IsString() @MaxLength(150) previousSchool?: string | null;
  @Transform(tidy) @IsString() @IsNotEmpty() @MaxLength(100) guardianFirstName: string;
  @Transform(tidy) @IsString() @IsNotEmpty() @MaxLength(100) guardianLastName: string;
  @IsIn(RELATIONS) guardianRelation: Relation;
  @Transform(tidy) @IsString() @IsNotEmpty() @MaxLength(32) guardianPhone: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value)) @IsEmail() @MaxLength(254) guardianEmail?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) notes?: string | null;
}

export class MoveAdmissionDto {
  @IsIn(ADMISSION_STATUSES) status: AdmissionStatus;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(1000) note?: string | null;
}

export class AssessmentDto {
  @IsIn(['interview', 'test']) kind: 'interview' | 'test';
  @IsISO8601({ strict: true }) scheduledAt: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) conductedBy: string;
}

export class AssessmentResultDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) score?: number | null;
  @IsIn(['pending', 'pass', 'fail']) result: 'pending' | 'pass' | 'fail';
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) notes?: string | null;
}

export class EnrollApplicantDto {
  @IsUUID() sectionId: string;
  @IsOptional() @IsInt() @Min(1) @Max(9999) rollNo?: number | null;
  @IsOptional() @IsDateOnly() admissionDate?: string;
  /** Create a parent login (needs the guardian's email). */
  @IsOptional() @ValidateNested() @Type(() => LoginPasswordDto) parentLogin?: LoginPasswordDto;
  @IsOptional() @ValidateNested() @Type(() => StudentLoginDto) studentLogin?: StudentLoginDto;
  /** Generate a parent login (application email, temporary password returned once). */
  @IsOptional() @IsBoolean() createParentLogin?: boolean;
  /** Generate a student login (school email from the admission no., temporary password returned once). */
  @IsOptional() @IsBoolean() createStudentLogin?: boolean;
}

export class ListApplicationsQuery {
  @IsOptional() @IsIn(ADMISSION_STATUSES) status?: AdmissionStatus;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
