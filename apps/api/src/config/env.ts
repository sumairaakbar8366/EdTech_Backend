import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { Transform } from 'class-transformer';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

/** Environment schema. The app refuses to start when it is invalid. */
export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URL: string;

  @IsString()
  BASE_DOMAIN: string;

  @IsString()
  PLATFORM_HOST: string;

  @Transform(toBoolean)
  @IsBoolean()
  TRUST_PROXY = false;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(60)
  @Max(3600)
  JWT_ACCESS_TTL_SECONDS = 900;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(90)
  REFRESH_TOKEN_TTL_DAYS = 30;

  /** Directory for uploaded files when using local disk storage. */
  @IsString()
  STORAGE_DIR = './storage';

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  MAX_UPLOAD_MB = 10;

  @IsOptional()
  @IsEmail()
  SEED_PLATFORM_ADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  @MinLength(12)
  SEED_PLATFORM_ADMIN_PASSWORD?: string;

  @Transform(toBoolean)
  @IsBoolean()
  SEED_DEMO_SCHOOL = false;
}

export function validateEnv(config: Record<string, unknown>): Env {
  const env = plainToInstance(Env, config, { exposeDefaultValues: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  return env;
}
