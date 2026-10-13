import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CurrentAuth, PlatformOnly } from '../../auth/decorators.js';
import type { AuthContext } from '../../common/request-context.js';
import { DELIVERY_QUEUE, DeliveryService } from '../../delivery/delivery.service.js';
import type { DeliveryChannel } from '../../delivery/delivery.types.js';
import { QueuesService } from '../../jobs/queues.service.js';
import { SCHEDULED_QUEUE, SchedulerService } from '../../jobs/scheduler.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const CHANNELS = ['email', 'sms', 'whatsapp', 'push'] as const;
const STATUSES = ['queued', 'sent', 'failed'] as const;

class DeliveryListQuery {
  @IsOptional() @IsIn(CHANNELS) channel?: DeliveryChannel;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsUUID() schoolId?: string;
  /** Matches the recipient or the template. */
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

class TestMessageDto {
  @IsIn(CHANNELS) channel: DeliveryChannel;
  @IsString() @MaxLength(200) to: string;
}

/** Platform console "System": outbound delivery log, test messages and scheduled jobs. */
@PlatformOnly()
@Controller('platform/system')
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly queues: QueuesService,
    private readonly scheduler: SchedulerService,
  ) {}

  @Get('deliveries')
  async deliveries(@Query() q: DeliveryListQuery) {
    const where = {
      channel: q.channel,
      status: q.status,
      schoolId: q.schoolId,
      ...(q.search ? { OR: [{ recipient: { contains: q.search, mode: 'insensitive' as const } }, { template: { contains: q.search, mode: 'insensitive' as const } }] } : {}),
    };
    const [items, total, byStatus] = await Promise.all([
      this.prisma.outboundMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { school: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.outboundMessage.count({ where }),
      this.prisma.outboundMessage.groupBy({ by: ['status'], _count: { _all: true }, where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    const last24h = Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0]));
    return { items, total, page: q.page, pageSize: q.pageSize, last24h, providers: this.delivery.channelProviders() };
  }

  @Post('deliveries/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async test(@CurrentAuth() auth: AuthContext, @Body() dto: TestMessageDto) {
    const admin = auth.scope === 'platform' ? await this.prisma.platformAdmin.findUnique({ where: { id: auth.adminId }, select: { email: true } }) : null;
    return this.delivery.send({ channel: dto.channel, to: dto.to, template: 'test', data: { sentBy: admin?.email ?? 'the platform owner' } });
  }

  @Get('jobs')
  async jobs() {
    const [jobs, delivery, scheduled] = await Promise.all([
      this.scheduler.list(),
      this.queues.counts(DELIVERY_QUEUE).catch(() => null),
      this.queues.counts(SCHEDULED_QUEUE).catch(() => null),
    ]);
    return { workersEnabled: this.queues.enabled, queues: { delivery, scheduled }, jobs };
  }

  /** Runs a scheduled job immediately in this request (for checks and catching up). */
  @Post('jobs/:id/run')
  @HttpCode(HttpStatus.OK)
  async run(@Param('id') id: string) {
    if (!this.scheduler.has(id)) throw new NotFoundException('Scheduled job not found');
    return { result: await this.scheduler.execute(id) };
  }
}
