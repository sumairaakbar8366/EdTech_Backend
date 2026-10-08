import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SCHOOL_SLUG_PATTERN } from '@schoolerp/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class InitialAdminDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password: string;
}

export class MainCampusDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9-]{1,20}$/, { message: 'code must be 1–20 letters, digits or hyphens' })
  code: string;
}

export class CreateSchoolDto {
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @Transform(trimLower)
  @Matches(SCHOOL_SLUG_PATTERN, {
    message: 'slug must be 3–63 lowercase letters, digits or inner hyphens',
  })
  slug: string;

  @IsString()
  @IsNotEmpty()
  tierCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' })
  currency?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'primaryColor must be a 6-digit hex color' })
  primaryColor?: string;

  @ValidateNested()
  @Type(() => MainCampusDto)
  campus: MainCampusDto;

  @ValidateNested()
  @Type(() => InitialAdminDto)
  admin: InitialAdminDto;
}

export class UpdateSchoolStatusDto {
  @IsIn(['active', 'suspended'])
  status: 'active' | 'suspended';
}
