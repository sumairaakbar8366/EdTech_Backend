import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { SOCIAL_PROVIDERS, type SocialProvider } from './social-identity.service.js';

export class LoginDto {
  /** The person's email (or, for a student without one, the User ID such as STU-2026-0142). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;

  /** Keep the session after the browser closes. Off by default: a browser-session cookie. */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword: string;

  /** Same rule as passwords set by administrators. */
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  newPassword: string;
}

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class ForgotPasswordDto {
  /** Email (or User ID on a school site). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier: string;
}

export class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(100) token: string;
  @IsString() @MinLength(12) @MaxLength(256) newPassword: string;
}

/** "Continue with Google" on /login: Google's ID token and nonce; `school` when choosing between several. */
export class SocialTicketDto {
  @IsIn(SOCIAL_PROVIDERS) provider: SocialProvider;
  @IsString() @MinLength(20) @MaxLength(8192) credential: string;
  @IsString() @MinLength(16) @MaxLength(128) nonce: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(63) school?: string;
}

/** The main domain's single /login: email or User ID, password, and the school when choosing. */
export class UniversalLoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier: string;

  @IsString() @MinLength(1) @MaxLength(256) password: string;

  /** A school's slug, or "console" for the owner console. */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(63) school?: string;

  @IsOptional() @IsBoolean() remember?: boolean;
}

export class TicketDto {
  @IsString() @MinLength(20) @MaxLength(100) ticket: string;
}

export class ResetTokenDto {
  @IsString() @MinLength(20) @MaxLength(100) token: string;
}

export class ForgotUserIdDto {
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email: string;
}

export class SendEmailCodeDto {
  /** Leave out to verify the email already on the account. */
  @IsOptional() @Transform(lowerTrim) @IsEmail() @MaxLength(254) email?: string;
}

export class VerifyEmailCodeDto {
  @IsUUID() verificationId: string;
  @IsString() @Length(6, 6) @Matches(/^\d{6}$/) code: string;
}
