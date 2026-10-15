import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeliveryService, type SendRequest } from './delivery.service.js';
import type { TemplateName } from './templates/index.js';

export type OwnerAlertKind = 'school_signup' | 'school_application' | 'payment_received' | 'password_reset_request' | 'user_id_request' | 'password_reset_done';

export interface OwnerAlert<N extends TemplateName = TemplateName> {
  kind: OwnerAlertKind;
  title: string;
  body?: string | null;
  /** Console path, e.g. "/schools/<id>". */
  link?: string | null;
  schoolId?: string | null;
  /** Who made the request (email or User ID as typed). */
  actor?: string | null;
  /** Also email every active owner with this template. */
  email?: Pick<SendRequest<N>, 'template' | 'data'>;
}

/**
 * Tells the platform owner what happened: a row in the console's notification list (always) and,
 * when given, an email to every active owner. Never throws: the action that raised it stands.
 */
@Injectable()
export class OwnerAlertsService {
  private readonly log = new Logger(OwnerAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
  ) {}

  async raise<N extends TemplateName>(a: OwnerAlert<N>): Promise<void> {
    try {
      await this.prisma.platformNotification.create({
        data: { kind: a.kind, title: a.title.slice(0, 300), body: a.body?.slice(0, 2000) ?? null, link: a.link ?? null, schoolId: a.schoolId ?? null, actor: a.actor?.slice(0, 254) ?? null },
      });
    } catch (e) {
      this.log.error(`owner alert ${a.kind} not stored: ${(e as Error).message}`);
    }
    if (!a.email) return;
    try {
      const owners = await this.prisma.platformAdmin.findMany({ where: { isActive: true }, select: { email: true } });
      for (const o of owners) await this.delivery.trySend({ channel: 'email', to: o.email, schoolId: a.schoolId ?? null, template: a.email.template, data: a.email.data } as SendRequest<N>);
    } catch (e) {
      this.log.error(`owner alert ${a.kind} not emailed: ${(e as Error).message}`);
    }
  }
}
