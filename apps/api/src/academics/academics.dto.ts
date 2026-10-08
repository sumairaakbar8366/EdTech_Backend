import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// --- Academic years & terms ----------------------------------------------------

export class CreateAcademicYearDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsDateOnly()
  startDate: string;

  @IsDateOnly()
  endDate: string;

  /** Make this the current year. The first year a school creates always becomes current. */
  @IsOptional()
  @IsBoolean()
  makeCurrent?: boolean;
}

export class UpdateAcademicYearDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsDateOnly()
  startDate?: string;

  @IsOptional()
  @IsDateOnly()
  endDate?: string;
}

export class CreateTermDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsDateOnly()
  startDate: string;

  @IsDateOnly()
  endDate: string;
}

export class UpdateTermDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsDateOnly()
  startDate?: string;

  @IsOptional()
  @IsDateOnly()
  endDate?: string;
}

// --- Classes, sections, subjects, rooms ------------------------------------------

export class CreateClassDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsInt()
  @Min(1)
  @Max(100)
  level: number;
}

export class UpdateClassDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  level?: number;
}

export class CreateSectionDto {
  @IsUUID()
  classId: string;

  @IsUUID()
  campusId: string;

  @Transform(trimUpper)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  name?: string;

  /** `null` clears the capacity. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number | null;
}

export class ListSectionsQuery {
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;
}

export class CreateSubjectDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Transform(trimUpper)
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'code must be 1–20 letters, digits or hyphens' })
  code: string;
}

export class UpdateSubjectDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Transform(trimUpper)
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'code must be 1–20 letters, digits or hyphens' })
  code?: string;
}

export class SetClassSubjectsDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  subjectIds: string[];
}

export class CreateRoomDto {
  @IsUUID()
  campusId: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  capacity?: number;
}

export class UpdateRoomDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  /** `null` clears the capacity. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  capacity?: number | null;
}
