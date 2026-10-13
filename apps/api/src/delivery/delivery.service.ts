import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError, type Job } from 'bullmq';
import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Env } from '../config/env.js';
import { QueuesService } from '../jobs/queues.service.js';
import { SchedulerService } from '../jobs/scheduler.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermanentDeliveryError, type ChannelProvider, type DeliveryChannel, type OutgoingMessage, type RenderedMessage } from './delivery.types.js';
import { OutboxProvider } from './providers/outbox.provider.js';
import { SmtpProvider } from './providers/smtp.provider.js';
import { TwilioSmsProvider } from './providers/twilio-sms.provider.js';
import { WebPushProvider } from './providers/web-push.provider.js';
import { WhatsAppCloudProvider } from './providers/whatsapp-cloud.provider.js';
import { TEMPLATES, type TemplateData, type TemplateName } from './templates/index.js';

export const DELIVERY_QUEUE = 'delivery';
const ATTEMPTS = 5;
/** Delivery log rows and outbox files older than this are deleted by the nightly clean-up. */
const LOG_RETENTION_DAYS = 180;
const OUTBOX_RETENTION_DAYS = 30;

export interface SendRequest<N extends TemplateName> {
  channel: DeliveryChannel;
  /** Email address, E.164 phone number (+923001234567) or push subscription id. */
  to: string;
  template: N;
  data: TemplateData<N>;
  /** The school the message belongs to (null for platform messages). */
  schoolId?: string | null;
}

type DeliveryJob = Omit<OutgoingMessage, 'id'> & { messageId: string };

interface AnyTemplate {
  channels: readonly DeliveryChannel[];
  render(data: unknown): RenderedMessage;
}

/**
 * Outbound email / SMS / WhatsApp / push. `send()` renders the template, logs the message in
 * outbound_messages and queues it; the queue worker delivers it with up to 5 attempts (exponential
 * back-off from 30 s). Business actions never wait for the provider.
 */
@Injectable()
export class DeliveryService implements OnModuleInit {
  private readonly log = new Logger(DeliveryService.name);
  private readonly providers: Record<DeliveryChannel, ChannelProvider>;
  private readonly storageDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueuesService,
    private readonly scheduler: SchedulerService,
    config: ConfigService<Env, true>,
  ) {
    this.storageDir = config.get('STORAGE_DIR', { infer: true });
    const outbox = new OutboxProvider(this.storageDir);
    const email =
      config.get('EMAIL_DRIVER', { infer: true }) === 'smtp'
        ? new SmtpProvider(
            {
              host: config.get('SMTP_HOST', { infer: true })!,
              port: config.get('SMTP_PORT', { infer: true }),
              secure: config.get('SMTP_SECURE', { infer: true }),
              user: config.get('SMTP_USER', { infer: true }),
              pass: config.get('SMTP_PASS', { infer: true }),
            },
            config.get('MAIL_FROM', { infer: true }),
          )
        : outbox;
    const env = <K extends keyof Env>(k: K) => config.get(k, { infer: true }) as Env[K];
    const sms = env('SMS_DRIVER') === 'twilio' ? new TwilioSmsProvider({ accountSid: env('TWILIO_ACCOUNT_SID')!, authToken: env('TWILIO_AUTH_TOKEN')!, from: env('TWILIO_FROM')! }) : outbox;
    const whatsapp =
      env('WHATSAPP_DRIVER') === 'cloud'
        ? new WhatsAppCloudProvider({ token: env('WHATSAPP_TOKEN')!, phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID')!, template: env('WHATSAPP_TEMPLATE'), language: env('WHATSAPP_TEMPLATE_LANGUAGE') })
        : outbox;
    const push = env('PUSH_DRIVER') === 'webpush' ? new WebPushProvider(prisma, { publicKey: env('VAPID_PUBLIC_KEY')!, privateKey: env('VAPID_PRIVATE_KEY')!, subject: env('VAPID_SUBJECT') }) : outbox;
    this.providers = { email, sms, whatsapp, push };
  }

  onModuleInit(): void {
    this.queues.work<DeliveryJob>(DELIVERY_QUEUE, (job) => this.deliver(job));
    this.scheduler.register({
      id: 'delivery.cleanup',
      cron: '30 3 * * *',
      description: `Deletes delivery log entries older than ${LOG_RETENTION_DAYS} days and outbox files older than ${OUTBOX_RETENTION_DAYS} days`,
      run: () => this.cleanup(),
    });
  }

  /** Which provider handles each channel in this deployment. */
  channelProviders(): Record<DeliveryChannel, string> {
    return { email: this.providers.email.name, sms: this.providers.sms.name, whatsapp: this.providers.whatsapp.name, push: this.providers.push.name };
  }

  /** Queues a message. Throws if the template does not support the channel or the queue is unreachable. */
  async send<N extends TemplateName>(req: SendRequest<N>): Promise<{ id: string }> {
    const template = TEMPLATES[req.template] as AnyTemplate;
    if (!template.channels.includes(req.channel)) throw new BadRequestException(`Template ${req.template} cannot be sent by ${req.channel}`);
    const to = normaliseRecipient(req.channel, req.to);
    const rendered = template.render(req.data);
    const row = await this.prisma.outboundMessage.create({
      data: { schoolId: req.schoolId ?? null, channel: req.channel, recipient: to, template: req.template, subject: rendered.subject, provider: this.providers[req.channel].name },
      select: { id: true },
    });
    try {
      await this.queues.queue(DELIVERY_QUEUE).add(
        req.template,
        { messageId: row.id, channel: req.channel, to, schoolId: req.schoolId ?? null, ...rendered } satisfies DeliveryJob,
        // The payload may hold a one-time code: drop it from Redis as soon as the job ends.
        { jobId: row.id, attempts: ATTEMPTS, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: true },
      );
    } catch (e) {
      await this.prisma.outboundMessage.update({ where: { id: row.id }, data: { status: 'failed', error: `Not queued: ${(e as Error).message}` } });
      throw e;
    }
    return row;
  }

  /** `send()` for side notifications: failures are logged, never thrown. */
  async trySend<N extends TemplateName>(req: SendRequest<N>): Promise<void> {
    try {
      await this.send(req);
    } catch (e) {
      this.log.error(`${req.channel} ${req.template} to ${req.to} not queued: ${(e as Error).message}`);
    }
  }

  private async deliver(job: Job<DeliveryJob>): Promise<void> {
    const { messageId, ...m } = job.data;
    const attempt = job.attemptsMade + 1;
    const provider = this.providers[m.channel];
    try {
      const r = await provider.send({ id: messageId, ...m });
      await this.prisma.outboundMessage.update({
        where: { id: messageId },
        data: { status: 'sent', attempts: attempt, sentAt: new Date(), provider: provider.name, providerMessageId: r.providerMessageId ?? null, error: null },
      });
    } catch (e) {
      const permanent = e instanceof PermanentDeliveryError;
      const last = permanent || attempt >= (job.opts.attempts ?? ATTEMPTS);
      await this.prisma.outboundMessage
        .update({ where: { id: messageId }, data: { status: last ? 'failed' : 'queued', attempts: attempt, error: (e as Error).message.slice(0, 1000) } })
        .catch(() => undefined);
      throw permanent ? new UnrecoverableError((e as Error).message) : e;
    }
  }

  private async cleanup() {
    const before = new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000);
    const { count } = await this.prisma.outboundMessage.deleteMany({ where: { createdAt: { lt: before } } });
    const cutoff = new Date(Date.now() - OUTBOX_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    const dir = resolve(this.storageDir, 'outbox');
    const days = await readdir(dir).catch(() => [] as string[]);
    const old = days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff);
    await Promise.all(old.map((d) => rm(resolve(dir, d), { recursive: true, force: true })));
    return { logRowsDeleted: count, outboxDaysDeleted: old.length };
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;

/** Lower-cases emails; turns phone numbers into international (E.164) form, reading local numbers as Pakistani. */
export function normaliseRecipient(channel: DeliveryChannel, to: string): string {
  const v = to.trim();
  if (channel === 'email') {
    if (!EMAIL.test(v)) throw new BadRequestException(`"${v}" is not a valid email address`);
    return v.toLowerCase();
  }
  if (channel === 'sms' || channel === 'whatsapp') {
    let phone = v.replace(/[\s()-]/g, '');
    // Local Pakistani numbers (0300 1234567): every school on the platform is in Pakistan.
    if (/^0\d{10}$/.test(phone)) phone = `+92${phone.slice(1)}`;
    else if (/^0092\d{10}$/.test(phone)) phone = `+${phone.slice(2)}`;
    if (!E164.test(phone)) throw new BadRequestException(`"${v}" is not an international phone number (e.g. +923001234567)`);
    return phone;
  }
  if (!v) throw new BadRequestException('Recipient is required');
  return v;
}
