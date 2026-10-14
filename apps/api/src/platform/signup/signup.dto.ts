import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { SOCIAL_PROVIDERS, type SocialProvider } from '../../auth/social-identity.service.js';
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

/**
 * Quick sign-up (the "Start free trial" pop-up): the school's name plus either a Google credential or
 * an email and name. The web address and the admin's password are generated; the password is emailed.
 */
export class QuickSignupDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) schoolName: string;

  /** "Continue with Google": Google's ID token and its nonce; the email and name come from it. */
  @IsOptional() @IsIn(SOCIAL_PROVIDERS) provider?: SocialProvider;
  @IsOptional() @IsString() @MaxLength(8192) credential?: string;
  @IsOptional() @IsString() @MinLength(16) @MaxLength(128) nonce?: string;

  @Transform(trimLower) @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  /** "Ayesha Khan": split into first and last name. */
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(200) name?: string;

  /** Needed for the email route while EMAIL_VERIFICATION is "required". */
  @IsOptional() @IsUUID() verificationId?: string;
  @IsOptional() @IsString() @Matches(/^\d{6}$/) code?: string;
}
