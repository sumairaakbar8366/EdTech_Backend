import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface LoginEventInput extends LoginContext {
  schoolId?: string | null;
  userId?: string | null;
  platformAdminId?: string | null;
  identifier: string;
  loginId?: string | null;
  name?: string | null;
  roles?: string[] | null;
  method?: 'password' | 'ticket' | 'support' | 'google';
  success: boolean;
  reason?: string | null;
}

/** Login history: every sign-in attempt, successful or not. Recording never blocks a sign-in. */
@Injectable()
export class LoginEventsService {
  private readonly log = new Logger(LoginEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(e: LoginEventInput): Promise<void> {
    try {
      await this.prisma.loginEvent.create({
        data: {
          schoolId: e.schoolId ?? null,
          userId: e.userId ?? null,
          platformAdminId: e.platformAdminId ?? null,
          identifier: e.identifier.trim().toLowerCase().slice(0, 254),
          loginId: e.loginId ?? null,
          name: e.name ?? null,
          roles: e.roles?.join(',') ?? null,
          method: e.method ?? 'password',
          success: e.success,
          reason: e.reason ?? null,
          ip: e.ip?.slice(0, 64) ?? null,
          userAgent: e.userAgent?.slice(0, 300) ?? null,
        },
      });
    } catch (err) {
      this.log.error(`could not record login event: ${(err as Error).message}`);
    }
  }
}
