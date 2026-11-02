import { Transform } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { SOCIAL_PROVIDERS, type SocialProvider } from '../auth/social-identity.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trimOptional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** Roles a person may ask for themselves; administrators and principals are never self-requested. */
export const REQUESTABLE_ROLES = ['student', 'parent', 'teacher', 'non_teaching_staff', 'accounts'] as const;
export type RequestableRole = (typeof REQUESTABLE_ROLES)[number];

export class AccessEmailDto {
  @Transform(trimLower) @IsEmail() @MaxLength(254) email: string;
}
export class AccessEmailVerifyDto extends AccessEmailDto {
  @IsUUID() verificationId: string;
  @IsString() @Matches(/^\d{6}$/) code: string;
}
export class AccessGoogleDto {
  @IsIn(SOCIAL_PROVIDERS) provider: SocialProvider;
  @IsString() @MaxLength(8192) credential: string;
  @IsString() @MinLength(16) @MaxLength(128) nonce: string;
}

export class AccessRequestDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  @Transform(trimOptional) @IsOptional() @IsString() @Matches(/^[+0-9][0-9 ()-]{6,24}$/, { message: 'Enter a valid phone number' }) phone?: string;
  @IsIn(REQUESTABLE_ROLES) role: RequestableRole;
  /** Who they are at the school: the child's name and class for a parent, the class for a student, the subject for a teacher. */
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) note: string;
  @IsString() @MaxLength(64) emailProof: string;
  @Transform(trimLower) @IsEmail() @MaxLength(254) email: string;
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
}

export class ApproveAccessDto {
  /** Link to a record the school already has; without one a parent or staff record is created from the request. */
  @IsOptional() @IsIn(['staff', 'guardian', 'student']) personType?: 'staff' | 'guardian' | 'student';
  @IsOptional() @IsUUID() personId?: string;
  /** Job title for a new staff record. */
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(100) designation?: string;
  @IsOptional() @IsArray() @IsIn(REQUESTABLE_ROLES, { each: true }) roles?: RequestableRole[];
}

export class RejectAccessDto {
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(500) note?: string;
}
