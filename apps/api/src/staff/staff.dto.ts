import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
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
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value);

export const STAFF_TYPES = ['teaching', 'non_teaching'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract'] as const;
export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'resigned', 'terminated'] as const;
export const GENDERS = ['male', 'female', 'other'] as const;
/** Roles a staff login may hold. Student and parent accounts are created by their own modules. */
export const STAFF_LOGIN_ROLES = ['teacher', 'non_teaching_staff', 'accounts', 'school_admin', 'principal'] as const;

export class EmployeeProfileDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(40) nationalId?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) emergencyContactName?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(32) emergencyContactPhone?: string | null;
  @IsOptional() @Transform(trimOrNull) @Matches(/^(A|B|AB|O)[+-]$/, { message: 'bloodGroup must be like A+, O-, AB+' }) bloodGroup?: string | null;
}

export class TeacherProfileDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) specialization?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) bio?: string | null;
}

export class StaffLoginDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(STAFF_LOGIN_ROLES, { each: true })
  roles: (typeof STAFF_LOGIN_ROLES)[number][];
}

export class CreateEmployeeDto {
  @IsUUID() campusId: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value))
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'employeeNo must be 1–20 letters, digits or hyphens' })
  employeeNo?: string;

  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  @IsOptional() @Transform(lower) @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @IsIn(GENDERS) gender?: (typeof GENDERS)[number] | null;
  @IsOptional() @IsDateOnly() dateOfBirth?: string | null;
  @IsIn(STAFF_TYPES) staffType: (typeof STAFF_TYPES)[number];
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) designation: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(100) department?: string | null;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES) employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsDateOnly() joinDate: string;

  @IsOptional() @ValidateNested() @Type(() => EmployeeProfileDto) profile?: EmployeeProfileDto;
  @IsOptional() @ValidateNested() @Type(() => TeacherProfileDto) teacherProfile?: TeacherProfileDto;
  /** Create a login for this employee at the same time (requires email). */
  @IsOptional() @ValidateNested() @Type(() => StaffLoginDto) login?: StaffLoginDto;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsUUID() campusId?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) firstName?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) lastName?: string;
  @IsOptional() @Transform(lower) @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @IsIn(GENDERS) gender?: (typeof GENDERS)[number] | null;
  @IsOptional() @IsDateOnly() dateOfBirth?: string | null;
  @IsOptional() @IsIn(STAFF_TYPES) staffType?: (typeof STAFF_TYPES)[number];
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) designation?: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(100) department?: string | null;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES) employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsDateOnly() joinDate?: string;
  @IsOptional() @ValidateNested() @Type(() => EmployeeProfileDto) profile?: EmployeeProfileDto;
  @IsOptional() @ValidateNested() @Type(() => TeacherProfileDto) teacherProfile?: TeacherProfileDto;
}

export class ChangeStatusDto {
  @IsIn(EMPLOYEE_STATUSES) status: (typeof EMPLOYEE_STATUSES)[number];
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) reason?: string | null;
}

export class ListEmployeesQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(STAFF_TYPES) staffType?: (typeof STAFF_TYPES)[number];
  @IsOptional() @IsIn(EMPLOYEE_STATUSES) status?: (typeof EMPLOYEE_STATUSES)[number];
  @IsOptional() @IsUUID() campusId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class QualificationDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) degree: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) institution: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) yearCompleted?: number | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(30) grade?: string | null;
}

export class ExperienceDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) organization: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) role: string;
  @IsDateOnly() startDate: string;
  @IsOptional() @IsDateOnly() endDate?: string | null;
}

export class AssignTeacherDto {
  /** Defaults to the current academic year. */
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsUUID() sectionId: string;
  @IsUUID() subjectId: string;
  @IsUUID() employeeId: string;
}

export class ListAssignmentsQuery {
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() sectionId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
}
