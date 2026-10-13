import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const MARKS = /^\d{1,4}(\.\d{1,2})?$/;
const marks = (field: string) => Matches(MARKS, { message: `${field} must be a number like 100 or 32.5` });
const marksIn = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);

export class BandDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(5) grade: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) minPercent: number;
  @Transform(trim) @IsString() @MaxLength(60) remark: string;
}

export class GradingScaleDto {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => BandDto) bands: BandDto[];
}

export class ExamDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() termId?: string | null;
  @IsDateOnly() startDate: string;
  @IsDateOnly() endDate: string;
}

export class PaperDto {
  @IsUUID() subjectId: string;
  @IsOptional() @IsDateOnly() examDate?: string | null;
  @Transform(marksIn) @marks('maxMarks') maxMarks: string;
  @Transform(marksIn) @marks('passMarks') passMarks: string;
}

export class PapersDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => PaperDto) papers: PaperDto[];
}

export class MarksheetQuery {
  @IsUUID() sectionId: string;
  @IsUUID() subjectId: string;
}

export class MarkEntryDto {
  @IsUUID() studentId: string;
  @IsOptional() @Transform(marksIn) @marks('marks') marks?: string | null;
  @IsOptional() @IsBoolean() isAbsent?: boolean;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(200) remarks?: string | null;
}

export class MarksheetDto {
  @IsUUID() sectionId: string;
  @IsUUID() subjectId: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => MarkEntryDto) entries: MarkEntryDto[];
}

export class ExamListQuery {
  @IsOptional() @IsUUID() academicYearId?: string;
}

export class SectionQuery {
  @IsOptional() @IsUUID() sectionId?: string;
}

export class StudentQuery {
  @IsOptional() @IsUUID() studentId?: string;
}

export class RemarksDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) remarks?: string | null;
}

export class CorrectionLineDto {
  @IsString() @MaxLength(150) subject: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000) marks: number | null;
  @IsBoolean() isAbsent: boolean;
}

/** An administrator's correction of a report card (any exam, published or not). */
export class CorrectResultDto {
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => CorrectionLineDto) lines?: CorrectionLineDto[];
  /** true = pass, false = fail, null = from the marks. Leave out to keep it as it is. */
  @IsOptional() @IsBoolean() passOverride?: boolean | null;
  @IsOptional() @IsString() @MaxLength(1000) remarks?: string | null;
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class ResultSearchQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() examId?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() passed?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
