import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateSchoolApplicationDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  schoolName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contactFirstName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contactLastName: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  designation: string;

  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  contactEmail: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(120)
  schoolCity?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsUrl({ require_protocol: true })
  @MaxLength(255)
  schoolWebsite?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestedTierCode?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  preferredBrandColor?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ReviewSchoolApplicationDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';
}