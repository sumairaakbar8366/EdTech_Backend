import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { SCHOOL_SLUG_PATTERN } from '@schoolerp/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trimOptional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class SignupCodeDto {
  @Transform(trimLower) @IsEmail() @MaxLength(254) email: string;
}

/** Self-service sign-up: the school is created at once on a free trial. */
export class SignupDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) schoolName: string;

  @Transform(trimLower)
  @Matches(SCHOOL_SLUG_PATTERN, { message: 'The web address must be 3–63 lowercase letters, digits or inner hyphens' })
  slug: string;

  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(100) city?: string;

  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) firstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) lastName: string;
  /** Principal, owner, administrator… */
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) designation: string;

  @Transform(trimLower) @IsEmail() @MaxLength(254) email: string;
  @Transform(trim) @IsString() @Matches(/^[+0-9][0-9 ()-]{6,24}$/, { message: 'Enter a valid phone number' }) phone: string;

  /** The admin's own password (not temporary: they chose it). */
  @IsString() @MinLength(12) @MaxLength(256) password: string;

  /** The code emailed by POST /public/signup/code. */
  @IsUUID() verificationId: string;
  @IsString() @Matches(/^\d{6}$/) code: string;
}
