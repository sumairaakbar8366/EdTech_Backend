import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const moneyIn = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toFixed(2) : value);
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const money = (field: string) => Matches(MONEY, { message: `${field} must be an amount like 1500 or 1500.50` });

export class SalaryComponentDto {
  @IsIn(['earning', 'deduction']) kind: 'earning' | 'deduction';
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @IsIn(['fixed', 'percent_of_basic']) calc: 'fixed' | 'percent_of_basic';
  @Transform(moneyIn) @money('value') value: string;
}

export class SalaryStructureDto {
  @Transform(moneyIn) @money('basicSalary') basicSalary: string;
  @IsDateOnly() effectiveFrom: string;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SalaryComponentDto) components: SalaryComponentDto[];
}

export class CreateRunDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) name: string;
  @IsDateOnly() startDate: string;
  @IsDateOnly() endDate: string;
  @IsOptional() @IsBoolean() applyAttendance?: boolean;
}

export class AdjustItemDto {
  @Transform(moneyIn) @money('bonus') bonus: string;
  @Transform(moneyIn) @money('manualDeduction') manualDeduction: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(80) manualDeductionLabel?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) note?: string | null;
}

export class RunNoteDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) note: string;
}

export class PayRunDto {
  @IsIn(['cash', 'bank_transfer', 'card', 'cheque', 'online']) method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'online';
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(100) reference?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) paidAt?: string;
}
