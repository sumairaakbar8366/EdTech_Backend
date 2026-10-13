import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { SCHOOL_ROLE_KEYS, type SchoolRoleKey } from '@schoolerp/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const PERSON_TYPES = ['staff', 'guardian', 'student'] as const;
export type PersonType = (typeof PERSON_TYPES)[number];
export const USER_STATUSES = ['active', 'disabled'] as const;

export class ListUsersQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(SCHOOL_ROLE_KEYS) role?: SchoolRoleKey;
  @IsOptional() @IsIn([...USER_STATUSES, 'pending']) status?: (typeof USER_STATUSES)[number] | 'pending';
  @IsOptional() @IsIn(PERSON_TYPES) personType?: PersonType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class CandidatesQuery {
  @IsIn(PERSON_TYPES) type: PersonType;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
}

/** Proof that a person owns an email: the code sent by POST /users/email-code. */
export class EmailProofDto {
  @IsUUID() verificationId: string;
  @IsString() @Matches(/^\d{6}$/) code: string;
}

/** Give an existing staff member, parent or student a login. */
export class GrantAccessDto {
  @IsIn(PERSON_TYPES) personType: PersonType;
  @IsUUID() personId: string;
  /** The person's own email (defaults to the one on their record). Sign-in is by User ID. */
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value)) @IsEmail() @MaxLength(254) email?: string;
  /** The code the person received at that email (from POST /users/email-code), proving it is theirs. */
  @IsOptional() @ValidateNested() @Type(() => EmailProofDto) verification?: EmailProofDto;
  /** Staff only (parents get "parent", students get "student"). */
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(SCHOOL_ROLE_KEYS, { each: true }) roles?: SchoolRoleKey[];
}

export class EmailCodeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) email: string;
}

/** Change (or remove) a login's personal email. With a code it is saved as verified. */
export class SetEmailDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value))
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  @MaxLength(254)
  email: string | null;
  @IsOptional() @ValidateNested() @Type(() => EmailProofDto) verification?: EmailProofDto;
}

export class SetRolesDto {
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(SCHOOL_ROLE_KEYS, { each: true }) roles: SchoolRoleKey[];
}

export class SetStatusDto {
  @IsIn(USER_STATUSES) status: (typeof USER_STATUSES)[number];
}
