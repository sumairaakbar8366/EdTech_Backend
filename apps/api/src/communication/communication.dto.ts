import { SCHOOL_ROLE_KEYS } from '@schoolerp/shared';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AnnouncementDto {
  @IsString() @MinLength(2) @MaxLength(150)
  title!: string;

  @IsString() @MinLength(1) @MaxLength(5000)
  body!: string;

  /** Empty or missing means everyone in the school. */
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(SCHOOL_ROLE_KEYS.filter((r) => r !== 'school_admin' && r !== 'principal'), { each: true, message: 'Announcements go to staff, students or parents (admins publish them)' })
  targetRoles?: string[];

  /** Individual people picked by name (user ids); added to the roles' recipients. */
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  targetUserIds?: string[];
}

export class PeopleSearchQuery {
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsIn(SCHOOL_ROLE_KEYS)
  role?: string;
}

export class StartThreadDto {
  @IsUUID()
  studentId!: string;

  /** The other person (a teacher's or a guardian's user id), from /messages/contacts. */
  @IsUUID()
  recipientId!: string;

  @IsString() @MinLength(2) @MaxLength(150)
  subject!: string;

  @IsString() @MinLength(1) @MaxLength(5000)
  body!: string;
}

export class MessageDto {
  @IsString() @MinLength(1) @MaxLength(5000)
  body!: string;
}
