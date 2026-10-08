import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, IsUrl, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
/** Multipart fields arrive as strings. */
const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class CourseListQuery {
  @IsOptional() @IsUUID() studentId?: string;
}

export class MaterialDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) title: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) description?: string | null;
  /** Required for link materials; uploads send a file instead. */
  @IsOptional() @Transform(trimOrNull) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(500) url?: string | null;
  @IsOptional() @Transform(bool) @IsBoolean() isPublished?: boolean;
}

export class UpdateMaterialDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) title: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) description?: string | null;
  @IsBoolean() isPublished: boolean;
}

export class CommentDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2000) body: string;
  @IsOptional() @IsUUID() parentCommentId?: string;
}

export class AssignmentDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) title: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(5000) instructions: string;
  @IsISO8601({ strict: true }) dueAt: string;
  @Matches(/^\d{1,4}(\.\d{1,2})?$/, { message: 'maxMarks must be a number like 20 or 12.5' }) maxMarks: string;
  @IsOptional() @Transform(bool) @IsBoolean() allowLate?: boolean;
  @IsOptional() @IsIn(['file', 'text', 'file_or_text']) mode?: 'file' | 'text' | 'file_or_text';
  @IsOptional() @Transform(bool) @IsBoolean() isPublished?: boolean;
}

export class SubmitDto {
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(20000) text?: string | null;
}

export class GradeDto {
  @Matches(/^\d{1,4}(\.\d{1,2})?$/, { message: 'marks must be a number like 18 or 17.5' }) marks: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) feedback?: string | null;
}

export class StudentQuery {
  @IsOptional() @IsUUID() studentId?: string;
}

export class AssignmentListQuery extends StudentQuery {
  @IsOptional() @Type(() => String) @IsIn(['pending', 'submitted', 'graded', 'all']) status?: 'pending' | 'submitted' | 'graded' | 'all';
}
