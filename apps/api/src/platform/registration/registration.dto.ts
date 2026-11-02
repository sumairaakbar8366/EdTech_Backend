import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested, ArrayMaxSize } from 'class-validator';
import { SOCIAL_PROVIDERS, type SocialProvider } from '../../auth/social-identity.service.js';
import { CustomFormDto } from '../../common/custom-form.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trimOptional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class RegEmailCodeDto {
  @Transform(trimLower) @IsEmail() @MaxLength(254) email: string;
}
export class RegEmailVerifyDto extends RegEmailCodeDto {
  @IsUUID() verificationId: string;
  @IsString() @Matches(/^\d{6}$/) code: string;
}
export class RegGoogleDto {
  @IsIn(SOCIAL_PROVIDERS) provider: SocialProvider;
  @IsString() @MaxLength(8192) credential: string;
  @IsString() @MinLength(16) @MaxLength(128) nonce: string;
}
export class RegPhoneCodeDto {
  @Transform(trim) @IsString() @MaxLength(32) phone: string;
  @IsOptional() @IsIn(['whatsapp', 'sms']) channel?: 'whatsapp' | 'sms';
}
export class RegPhoneVerifyDto {
  @Transform(trim) @IsString() @MaxLength(32) phone: string;
  @IsUUID() verificationId: string;
  @IsString() @Matches(/^\d{6}$/) code: string;
}

/** The registration form. Every field is checked again on the server; nothing here is trusted. */
export class RegisterSchoolDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) schoolName: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(100) schoolType?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(60) registrationNo?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(30) ntn: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) country: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) province: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) city: string;
  @Transform(trim) @IsString() @MinLength(8) @MaxLength(300) address: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(200) website?: string;

  @IsInt() @Min(0) @Max(1_000_000) studentCount: number;
  @IsInt() @Min(0) @Max(100_000) teacherCount: number;
  @IsInt() @Min(0) @Max(100_000) staffCount: number;

  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) ownerFirstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) ownerLastName: string;
  @Transform(trim) @IsString() @IsIn(['Owner', 'Chairman / Director', 'Principal', 'Administrator']) designation: string;
  @Transform(trim) @IsString() @MaxLength(20) nic: string;

  @Transform(trimLower) @IsEmail() @MaxLength(254) email: string;
  @Transform(trim) @IsString() @MaxLength(32) phone: string;

  /** From /email-verify or /google, and /phone-verify. */
  @IsString() @MaxLength(64) emailProof: string;
  @IsOptional() @IsString() @MaxLength(64) phoneProof?: string;

  /** Answers to the owner's extra questions. */
  @IsOptional() @IsObject() answers?: Record<string, unknown>;

  /** The applicant confirms the details are true and agrees to the terms. */
  @IsBoolean() declaration: boolean;
}

// --- Owner console ---------------------------------------------------------------------

export class TrialBandDto {
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) upTo: number | null;
  @IsInt() @Min(1) @Max(365) days: number;
  @Transform(trim) @IsString() @MaxLength(80) label: string;
}

export class PolicyDto {
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => TrialBandDto) trialBands: TrialBandDto[];
  @IsBoolean() requirePhoneCode: boolean;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(60, { each: true }) allowedCountries: string[];
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) schoolTypes: string[];
  @IsInt() @Min(1) @Max(1000) minStudents: number;
  @IsInt() @Min(10) @Max(1_000_000) maxStudents: number;
}

export class SaveRegistrationFormDto {
  @ValidateNested() @Type(() => CustomFormDto) form: CustomFormDto;
  @ValidateNested() @Type(() => PolicyDto) policy: PolicyDto;
}

/** The team's checklist: each item is ticked after checking it by hand (CNIC on NADRA's portal, NTN on FBR's, the school's registration, a call to the owner). */
export class ChecklistDto {
  @IsBoolean() cnic: boolean;
  @IsBoolean() ntn: boolean;
  @IsBoolean() school: boolean;
  @IsBoolean() contact: boolean;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class ApproveApplicationDto {
  /** Overrides the trial length suggested by the school's size. */
  @IsOptional() @IsInt() @Min(1) @Max(365) trialDays?: number;
}

export class RejectApplicationDto {
  /** Sent to the applicant: say what could not be verified. */
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reason: string;
}
