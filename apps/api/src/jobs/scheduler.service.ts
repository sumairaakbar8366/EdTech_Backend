import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { QueuesService } from './queues.service.js';

export const SCHEDULED_QUEUE = 'scheduled';
const LAST_RUN_KEY = 'schoolerp:jobs:last-run';

export interface LastRun {
  at: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface ScheduledJob {
  /** Stable id, e.g. "billing.trial-expiry". Also the BullMQ job scheduler id. */
  id: string;
  /** Cron pattern (5 fields), evaluated in `tz`. */
  cron: string;
  /** IANA zone the cron runs in. Defaults to Asia/Karachi (all demo and launch schools). */
  tz?: string;
  description: string;
  run: () => Promise<unknown>;
}

/**
 * Cron-style background jobs. Modules call `register()` from onModuleInit; at bootstrap each job
 * becomes a BullMQ job scheduler in Redis, so it fires once per tick even with several API replicas
 * (only one worker picks each run up). Schedulers no longer registered by the code are removed.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly log = new Logger(SchedulerService.name);
  private readonly jobs = new Map<string, ScheduledJob>();
  constructor(
    private readonly queues: QueuesService,
    private readonly redis: RedisService,
  ) {}

  register(job: ScheduledJob): void {
    if (this.jobs.has(job.id)) throw new Error(`Scheduled job ${job.id} registered twice`);
    this.jobs.set(job.id, job);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.queues.enabled) return;
    const queue = this.queues.queue(SCHEDULED_QUEUE);
    try {
      for (const job of this.jobs.values()) {
        await queue.upsertJobScheduler(job.id, { pattern: job.cron, tz: job.tz ?? 'Asia/Karachi' }, { name: job.id, opts: { removeOnComplete: 50, removeOnFail: 100 } });
      }
      for (const existing of await queue.getJobSchedulers()) {
        if (existing.key && !this.jobs.has(existing.key)) await queue.removeJobScheduler(existing.key);
      }
    } catch (e) {
      // Redis down at startup: the API still serves requests; jobs resume on the next restart.
      this.log.error(`Could not register scheduled jobs: ${(e as Error).message}`);
      return;
    }
    this.queues.work(SCHEDULED_QUEUE, (job) => this.execute(job.name), { concurrency: 2 });
    this.log.log(`${this.jobs.size} scheduled job(s) registered`);
  }

  /** Runs a job now (console "Run now" and the queue worker). */
  async execute(id: string): Promise<unknown> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown scheduled job ${id}`);
    const started = Date.now();
    try {
      const result = await job.run();
      await this.recordRun(id, { at: new Date().toISOString(), ok: true, ms: Date.now() - started });
      return result;
    } catch (e) {
      await this.recordRun(id, { at: new Date().toISOString(), ok: false, error: (e as Error).message, ms: Date.now() - started });
      throw e;
    }
  }

  /** Last outcome per job, shared by every replica. */
  private async recordRun(id: string, run: LastRun): Promise<void> {
    await this.redis.hset(LAST_RUN_KEY, id, JSON.stringify(run)).catch((e: Error) => this.log.warn(`could not record run of ${id}: ${e.message}`));
  }

  async list() {
    const [schedulers, runs] = await Promise.all([
      this.queues.queue(SCHEDULED_QUEUE).getJobSchedulers().catch(() => []),
      this.redis.hgetall(LAST_RUN_KEY).catch(() => ({}) as Record<string, string>),
    ]);
    return [...this.jobs.values()].map((j) => {
      const s = schedulers.find((x) => x.key === j.id);
      const run = runs[j.id] ? (JSON.parse(runs[j.id]) as LastRun) : null;
      return { id: j.id, cron: j.cron, tz: j.tz ?? 'Asia/Karachi', description: j.description, nextRunAt: s?.next ? new Date(s.next) : null, lastRun: run };
    });
  }

  has(id: string): boolean {
    return this.jobs.has(id);
  }
}
