import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const lowerOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value);

export const GENDERS = ['male', 'female', 'other'] as const;
export const STUDENT_STATUSES = ['active', 'inactive', 'graduated', 'withdrawn'] as const;
export const RELATIONS = ['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other'] as const;
export type Relation = (typeof RELATIONS)[number];

export class StudentProfileDto {
  @IsOptional() @Transform(trimOrNull) @Matches(/^(A|B|AB|O)[+-]$/, { message: 'bloodGroup must be like A+, O-' }) bloodGroup?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(40) nationalId?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(60) religion?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(60) nationality?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) address?: string | null;
}

export class MedicalDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(1000) allergies?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(1000) conditions?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(1000) medications?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) doctorName?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(32) doctorPhone?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) notes?: string | null;
}

export class EmergencyContactDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) relationship: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(32) phone: string;
}

export class PreviousSchoolDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) schoolName: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(60) lastClass?: string | null;
  @IsOptional() @IsDateOnly() leftOn?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) reason?: string | null;
}

export class LoginPasswordDto {
  @IsString() @MinLength(12) @MaxLength(256) password: string;
}

export class GuardianDetailsDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(32) phone: string;
  @IsOptional() @Transform(lowerOrNull) @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(100) occupation?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(40) nationalId?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) address?: string | null;
}

/** Link an existing guardian (siblings) or create a new one. */
export class GuardianLinkDto {
  @IsOptional() @IsUUID() guardianId?: string;
  @IsOptional() @ValidateNested() @Type(() => GuardianDetailsDto) details?: GuardianDetailsDto;
  @IsIn(RELATIONS) relationship: Relation;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  /** Create a parent login for a new guardian (needs an email). */
  @IsOptional() @ValidateNested() @Type(() => LoginPasswordDto) login?: LoginPasswordDto;
}

export class EnrollDto {
  /** Defaults to the current academic year. */
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsUUID() sectionId: string;
  @IsOptional() @IsInt() @Min(1) @Max(9999) rollNo?: number | null;
}

export class StudentLoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(12) @MaxLength(256) password: string;
}

export class CreateStudentDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value))
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'admissionNo must be 1–20 letters, digits or hyphens' })
  admissionNo?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  @IsOptional() @IsIn(GENDERS) gender?: (typeof GENDERS)[number] | null;
  @IsDateOnly() dateOfBirth: string;
  @IsDateOnly() admissionDate: string;

  @IsOptional() @ValidateNested() @Type(() => StudentProfileDto) profile?: StudentProfileDto;
  @IsOptional() @ValidateNested() @Type(() => MedicalDto) medical?: MedicalDto;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => EmergencyContactDto) emergencyContacts?: EmergencyContactDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PreviousSchoolDto) previousSchools?: PreviousSchoolDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => GuardianLinkDto) guardians: GuardianLinkDto[];
  @IsOptional() @ValidateNested() @Type(() => EnrollDto) enrollment?: EnrollDto;
  @IsOptional() @ValidateNested() @Type(() => StudentLoginDto) login?: StudentLoginDto;
}

export class UpdateStudentDto {
  @Transform(trim) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) firstName?: string;
  @Transform(trim) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) lastName?: string;
  @IsOptional() @IsIn(GENDERS) gender?: (typeof GENDERS)[number] | null;
  @IsOptional() @IsDateOnly() dateOfBirth?: string;
  @IsOptional() @IsDateOnly() admissionDate?: string;
  @IsOptional() @ValidateNested() @Type(() => StudentProfileDto) profile?: StudentProfileDto;
  @IsOptional() @ValidateNested() @Type(() => MedicalDto) medical?: MedicalDto;
}

export class StudentStatusDto {
  @IsIn(STUDENT_STATUSES) status: (typeof STUDENT_STATUSES)[number];
}

export class ListStudentsQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsUUID() sectionId?: string;
  @IsOptional() @IsIn(STUDENT_STATUSES) status?: (typeof STUDENT_STATUSES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class ListGuardiansQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  /** Exact phone match ignoring formatting ("0300-1234567" = "+92 300 1234567"); used to link siblings. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) phone?: string;
}

export class PromoteDto {
  @IsUUID() fromAcademicYearId: string;
  @IsUUID() fromSectionId: string;
  @IsUUID() toAcademicYearId: string;
  @IsUUID() toSectionId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique() @IsUUID(undefined, { each: true }) studentIds: string[];
}

export class PromotionCandidatesQuery {
  @IsUUID() academicYearId: string;
  @IsUUID() sectionId: string;
}
