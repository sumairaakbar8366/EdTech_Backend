import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { CustomFormDto } from '../common/custom-form.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOptional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SponsorDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) name: string;
  @IsOptional() @IsIn(['company', 'foundation', 'individual', 'government']) kind?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(150) contactName?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(254) email?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ProgramDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) title: string;
  @IsOptional() @IsUUID() sponsorId?: string | null;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(3000) criteria?: string;
  @IsOptional() @IsNumber() @Min(0) awardAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) budget?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000) slots?: number;
  @Transform(trimOptional) @IsOptional() @Matches(DATE) deadline?: string | null;
  @IsOptional() @IsIn(['draft', 'recruiting', 'live', 'closed']) status?: 'draft' | 'recruiting' | 'live' | 'closed';
  /** Class levels it is for (e.g. 9, 10, 11, 12); empty = every class. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsInt({ each: true }) @Min(1, { each: true }) @Max(20, { each: true }) targetLevels?: number[];
  @IsOptional() @IsIn(['yearly', 'semester']) period?: 'yearly' | 'semester';
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(60) currentPeriod?: string | null;
  @IsOptional() @IsBoolean() continuesToUndergrad?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) minAverage?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) minAttendance?: number;
  @IsOptional() @IsBoolean() needRequired?: boolean;
}

export class DecideCandidatesDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids: string[];
  @IsIn(['selected', 'rejected', 'confirmed']) status: 'selected' | 'rejected' | 'confirmed';
}
export class AwardCandidatesDto {
  @IsUUID() programId: string;
  @IsString() @MaxLength(60) period: string;
}

export class SendOfferDto {
  @IsOptional() @IsUUID() programId?: string;
  @IsOptional() @IsUUID() schoolId?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(1500) message?: string;
}

export class SubmitRequestDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) contactName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(254) contactEmail: string;
  @IsInt() @Min(0) @Max(10000) studentsRequested: number;
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
}

export class DecideRequestDto {
  @IsIn(['approved', 'rejected']) status: 'approved' | 'rejected';
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class GrantItemDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) studentName: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(60) className?: string;
  @IsNumber() @Min(0) amount: number;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class AddGrantsDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => GrantItemDto) grants: GrantItemDto[];
}
export class SetGrantStatusDto {
  @IsIn(['pledged', 'disbursed', 'cancelled']) status: 'pledged' | 'disbursed' | 'cancelled';
}

export class ScholarshipFormDto {
  @ValidateNested() @Type(() => CustomFormDto) form: CustomFormDto;
}

export class PostDto {
  @IsIn(['award', 'scholarship', 'event', 'news']) kind: 'award' | 'scholarship' | 'event' | 'news';
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) title: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(5000) body: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(150) eventName?: string;
  @Transform(trimOptional) @IsOptional() @Matches(DATE) eventDate?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(150) location?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(150) schoolName?: string;
  @IsOptional() @IsBoolean() published?: boolean;
}

export class ImageCaptionDto {
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(200) caption?: string;
}
