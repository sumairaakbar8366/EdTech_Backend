import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const REQUEST_TYPES = ['marksheet', 'report_card', 'character_certificate', 'leaving_certificate', 'bonafide_certificate', 'transcript', 'fee_clearance', 'other'] as const;
export const REQUEST_STATUSES = ['submitted', 'in_review', 'ready', 'completed', 'rejected', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Who may move a request where (the requester can only cancel while it is still "submitted"). */
export const ADMIN_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  submitted: ['in_review', 'rejected'],
  in_review: ['ready', 'rejected'],
  ready: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export class CreateRequestDto {
  @IsUUID() studentId: string;
  @IsIn(REQUEST_TYPES) type: (typeof REQUEST_TYPES)[number];
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) purpose: string;
  /** e.g. which exam / session, or what "other" means. */
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(1000) details?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) copies?: number;
  @IsOptional() @IsIn(['pickup', 'digital']) delivery?: 'pickup' | 'digital';
}

export class ListRequestsQuery {
  @IsOptional() @IsIn(REQUEST_STATUSES) status?: RequestStatus;
  @IsOptional() @IsIn(REQUEST_TYPES) type?: (typeof REQUEST_TYPES)[number];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class MoveRequestDto {
  @IsIn(REQUEST_STATUSES) status: RequestStatus;
  /** Shown to the requester; required when rejecting. */
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(1000) note?: string | null;
  /** Issued file (a document of the student) when the request is ready for digital delivery. */
  @IsOptional() @IsUUID() documentId?: string | null;
}
