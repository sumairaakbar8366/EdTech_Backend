import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsUUID()
  employeeId!: string;

  @IsString() @MinLength(2) @MaxLength(150)
  title!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  details?: string;

  @IsOptional() @IsIn(['low', 'normal', 'high'])
  priority?: 'low' | 'normal' | 'high';

  @IsOptional() @IsISO8601({ strict: true })
  dueDate?: string;
}

export class TaskStatusDto {
  @IsIn(['todo', 'in_progress', 'done'])
  status!: 'todo' | 'in_progress' | 'done';

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}
