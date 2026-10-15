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

  // --- Background jobs and outbound delivery ------------------------------------------

  /** Run the queue workers and scheduled jobs in this process (CLI scripts turn it off). */
  @Transform(toBoolean)
  @IsBoolean()
  JOBS_ENABLED = true;

  /** "outbox" writes messages to STORAGE_DIR/outbox instead of sending them (development). */
  @IsIn(['outbox', 'smtp'])
  EMAIL_DRIVER: 'outbox' | 'smtp' = 'outbox';

  /** "twilio" sends real SMS (TWILIO_*); "outbox" writes them to files. */
  @IsIn(['outbox', 'twilio'])
  SMS_DRIVER: 'outbox' | 'twilio' = 'outbox';

  @IsOptional() @IsString() TWILIO_ACCOUNT_SID?: string;
  @IsOptional() @IsString() TWILIO_AUTH_TOKEN?: string;
  /** The Twilio number or alphanumeric sender id. */
  @IsOptional() @IsString() TWILIO_FROM?: string;

  /** "cloud" sends real WhatsApp messages through Meta's WhatsApp Business Cloud API (WHATSAPP_*). */
  @IsIn(['outbox', 'cloud'])
  WHATSAPP_DRIVER: 'outbox' | 'cloud' = 'outbox';

  @IsOptional() @IsString() WHATSAPP_TOKEN?: string;
  @IsOptional() @IsString() WHATSAPP_PHONE_NUMBER_ID?: string;
  /** An approved template with one {{1}} body parameter; needed for messages outside a 24-hour chat window. */
  @IsOptional() @IsString() WHATSAPP_TEMPLATE?: string;
  @IsString() WHATSAPP_TEMPLATE_LANGUAGE = 'en';

  /** "webpush" sends browser / phone notifications (VAPID_*); generate keys with `npx web-push generate-vapid-keys`. */
  @IsIn(['outbox', 'webpush'])
  PUSH_DRIVER: 'outbox' | 'webpush' = 'outbox';

  @IsOptional() @IsString() VAPID_PUBLIC_KEY?: string;
  @IsOptional() @IsString() VAPID_PRIVATE_KEY?: string;
  @IsString() VAPID_SUBJECT = 'mailto:support@schoolerp.local';

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT = 587;

  /** true for port 465 (implicit TLS); false uses STARTTLS on 587. */
  @Transform(toBoolean)
  @IsBoolean()
  SMTP_SECURE = false;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  /** How links in emails reach the web app: <scheme>://<school>.<BASE_DOMAIN>[:<port>]. */
  @IsIn(['http', 'https'])
  WEB_URL_SCHEME: 'http' | 'https' = 'http';

  /** Port of the web app in links (5173 for the Vite dev server); empty in production. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  WEB_URL_PORT?: number;

  /** Online payments: "sandbox" is the built-in test gateway (nothing is charged). */
  @IsIn(['sandbox'])
  PAYMENT_PROVIDER = 'sandbox' as const;

  /** Shared secret that signs gateway webhooks (HMAC-SHA256). Required in production. */
  @IsOptional()
  @IsString()
  @MinLength(32)
  PAYMENT_WEBHOOK_SECRET?: string;

  /**
   * "required": a 6-digit code proves each email (sign-up, first sign-in). "off" skips the codes so any
   * address can be used while testing; refused in production.
   */
  @IsIn(['required', 'off'])
  EMAIL_VERIFICATION: 'required' | 'off' = 'required';

  /** OAuth Web client ID for "Continue with Google" (Google Cloud Console). Empty: not offered. */
  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  /** Sender shown on every email, e.g. "SchoolERP <no-reply@schoolerp.pk>". */
  @IsString()
  MAIL_FROM = 'SchoolERP <no-reply@schoolerp.local>';
}

export function validateEnv(config: Record<string, unknown>): Env {
  const env = plainToInstance(Env, config, { exposeDefaultValues: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (env.NODE_ENV === 'production' && env.EMAIL_VERIFICATION === 'off') {
    throw new Error('Invalid environment configuration:\n  EMAIL_VERIFICATION=off is for testing only and cannot be used in production');
  }
  if (env.NODE_ENV === 'production' && env.EMAIL_DRIVER !== 'smtp') {
    throw new Error('Invalid environment configuration:\n  EMAIL_DRIVER=smtp is required in production: sign-up codes, reset links and new passwords must reach people');
  }
  if (env.NODE_ENV === 'production' && !env.PAYMENT_WEBHOOK_SECRET) {
    throw new Error('Invalid environment configuration:\n  PAYMENT_WEBHOOK_SECRET is required in production');
  }
  const missing = [
    ...(env.SMS_DRIVER === 'twilio' ? (['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] as const) : []),
    ...(env.WHATSAPP_DRIVER === 'cloud' ? (['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'] as const) : []),
    ...(env.PUSH_DRIVER === 'webpush' ? (['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const) : []),
  ].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Invalid environment configuration:\n  ${missing.join(', ')} required by the chosen SMS / WhatsApp / push driver`);
  if (env.EMAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
    throw new Error('Invalid environment configuration:\n  SMTP_HOST is required when EMAIL_DRIVER=smtp');
  }
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  return env;
}
