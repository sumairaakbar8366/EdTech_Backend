import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../common/date-only.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
/** Money as a string with at most 2 decimals, e.g. "1500" or "1500.50". */
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const money = (field: string) => Matches(MONEY, { message: `${field} must be an amount like 1500 or 1500.50` });
const moneyIn = ({ value }: { value: unknown }) => (typeof value === 'number' ? value.toFixed(2) : value);

export const FREQUENCIES = ['one_time', 'monthly', 'termly', 'annual'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export class CategoryDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z0-9-]{1,15}$/, { message: 'code must be 1–15 letters, digits or hyphens' }) code: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class StructureItemDto {
  @IsUUID() categoryId: string;
  @Transform(moneyIn) @money('amount') amount: string;
  @IsIn(FREQUENCIES) frequency: Frequency;
}

export class StructureDto {
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsUUID() classId: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => StructureItemDto) items: StructureItemDto[];
}

export class AssignStructureDto {
  /** Assign to these students; omit to assign every enrolled student of the class (optionally one section). */
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @ArrayUnique() @IsUUID(undefined, { each: true }) studentIds?: string[];
  @IsOptional() @IsUUID() sectionId?: string;
}

export class ConcessionDto {
  @IsIn(['discount', 'scholarship', 'relief']) kind: 'discount' | 'scholarship' | 'relief';
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsIn(['percentage', 'fixed']) valueType: 'percentage' | 'fixed';
  @Transform(moneyIn) @money('value') value: string;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AwardDto {
  @IsUUID() discountId: string;
  @IsUUID() studentId: string;
  @IsOptional() @IsUUID() academicYearId?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
  @IsDateOnly() validFrom: string;
  @IsDateOnly() validUntil: string;
}

export class GenerateInvoicesDto {
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsUUID() classId: string;
  @IsOptional() @IsUUID() sectionId?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(40) periodLabel: string;
  @IsDateOnly() issueDate: string;
  @IsDateOnly() dueDate: string;
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(FREQUENCIES, { each: true }) frequencies: Frequency[];
}

export class InvoiceListQuery {
  @IsOptional() @IsIn(['pending', 'partial', 'paid', 'overdue', 'waived', 'cancelled']) status?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class NoteDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) note: string;
}

export class AllocationDto {
  @IsUUID() invoiceId: string;
  @Transform(moneyIn) @money('amount') amount: string;
}

export class PaymentDto {
  @IsUUID() studentId: string;
  @Transform(moneyIn) @money('amount') amount: string;
  @IsIn(['cash', 'bank_transfer', 'card', 'cheque', 'online']) method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'online';
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(100) reference?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) paidAt?: string;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(500) notes?: string | null;
  /** Explicit split; omit to pay the oldest open invoices first. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations?: AllocationDto[];
}

export class PaymentListQuery {
  @IsOptional() @IsUUID() studentId?: string;
  /** Student name or admission number, receipt number or payment reference. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsDateOnly() from?: string;
  @IsOptional() @IsDateOnly() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class YearQuery {
  @IsOptional() @IsUUID() academicYearId?: string;
}

export class AwardListQuery {
  @IsOptional() @IsUUID() studentId?: string;
}
