import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AGAINST_KINDS, CATEGORY_KEYS, SEND_TO, SEVERITIES, STATUSES, type AgainstKind, type CategoryKey, type SendTo, type Severity, type Status } from './complaints.rules.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOptional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);
const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export class CreateComplaintDto {
  @IsIn(CATEGORY_KEYS) category: CategoryKey;
  @IsOptional() @IsIn(SEVERITIES) severity?: Severity;
  @Transform(trim) @IsString() @MinLength(4) @MaxLength(150) subject: string;
  @Transform(trim) @IsString() @MinLength(10, { message: 'Please describe what happened in a few words' }) @MaxLength(5000) body: string;
  /** Handlers then see only the kind of person, never the name. */
  @IsBoolean() anonymous: boolean;
  @IsIn(AGAINST_KINDS) againstKind: AgainstKind;
  @IsOptional() @IsUUID() againstUserId?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(150) againstName?: string;
  /** Default: the school's management (principal and admin). */
  @IsOptional() @IsIn(SEND_TO) sendTo?: SendTo;
  /** For sendTo "student_parents". */
  @IsOptional() @IsUUID() studentId?: string;
  /** For sendTo "teacher": the teacher's login. */
  @IsOptional() @IsUUID() teacherUserId?: string;
  /** For sendTo "class_parents": a section, or a whole class. */
  @IsOptional() @IsUUID() sectionId?: string;
  @IsOptional() @IsUUID() classId?: string;
}

export class ComplaintMessageDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(3000) body: string;
  /** Handlers only: a private note the complainant never sees. */
  @IsOptional() @IsBoolean() internal?: boolean;
}

export class SetComplaintStatusDto {
  @IsIn(STATUSES) status: Status;
  /** Optional: how it was resolved. Sent to the complainant when given. */
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(3000) note?: string;
}

export class ComplaintListQuery {
  @IsOptional() @IsIn(STATUSES) status?: Status;
  @IsOptional() @IsIn(CATEGORY_KEYS) category?: CategoryKey;
  @IsOptional() @IsIn(SEVERITIES) severity?: Severity;
  @IsOptional() @IsIn(AGAINST_KINDS) againstKind?: AgainstKind;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @Transform(toInt) @IsOptional() @IsInt() @Min(1) page = 1;
  @Transform(toInt) @IsOptional() @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class PeopleQuery {
  @IsIn(AGAINST_KINDS) kind: AgainstKind;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(80) q?: string;
}
