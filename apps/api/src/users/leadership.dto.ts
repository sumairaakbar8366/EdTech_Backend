import { Transform, Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { DASHBOARD_SECTION_KEYS, LEADERSHIP_TITLES } from '@schoolerp/shared';
import { EmailProofDto } from './users.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const TITLE_KEYS = LEADERSHIP_TITLES.map((t) => t.key);

export class AddLeaderDto {
  @IsIn(TITLE_KEYS) titleKey: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) customTitle?: string;
  @Transform(trim) @IsString() @MaxLength(80) @Matches(/\S/) firstName: string;
  @Transform(trim) @IsString() @MaxLength(80) @Matches(/\S/) lastName: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) email: string;
  @IsOptional() @ValidateNested() @Type(() => EmailProofDto) verification?: EmailProofDto;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(DASHBOARD_SECTION_KEYS as readonly string[], { each: true }) hiddenSections?: string[];
}

export class UpdateLeaderDto {
  @IsOptional() @IsIn(TITLE_KEYS) titleKey?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) customTitle?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(DASHBOARD_SECTION_KEYS as readonly string[], { each: true }) hiddenSections?: string[];
}
