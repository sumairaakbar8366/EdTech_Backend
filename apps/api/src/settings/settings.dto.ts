import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const HEX = /^#[0-9a-fA-F]{6}$/;

export class SchoolSettingsDto {
  @IsOptional() @IsString() @MaxLength(64)
  timezone?: string;

  @IsOptional() @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @IsOptional() @IsIn(['en', 'ur', 'ar'])
  locale?: string;

  /** null = the standard SchoolERP theme (a custom colour is optional). */
  @IsOptional() @Matches(HEX, { message: 'primaryColor must be a #RRGGBB colour' })
  primaryColor?: string | null;

  @IsOptional() @Matches(HEX, { message: 'secondaryColor must be a #RRGGBB colour' })
  secondaryColor?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  weeklyOffDays?: number[];
}

export class DomainDto {
  @IsString() @MaxLength(253)
  hostname!: string;
}
