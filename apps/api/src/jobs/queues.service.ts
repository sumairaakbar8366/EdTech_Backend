import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job, type Processor, type WorkerOptions } from 'bullmq';
import type { Env } from '../config/env.js';
import { queueConnection } from './queue-connection.js';

export const QUEUE_PREFIX = 'schoolerp';

/**
 * Owns every BullMQ queue and worker in the process. Producers call `queue(name)`; consumers call
 * `work(name, processor)`, which does nothing when JOBS_ENABLED is false (CLI scripts, extra API replicas).
 */
@Injectable()
export class QueuesService implements OnApplicationShutdown {
  private readonly log = new Logger(QueuesService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  readonly enabled: boolean;
  private readonly connection;

  constructor(config: ConfigService<Env, true>) {
    this.enabled = config.get('JOBS_ENABLED', { infer: true });
    this.connection = queueConnection(config.get('REDIS_URL', { infer: true }));
  }

  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, prefix: QUEUE_PREFIX });
      q.on('error', (e) => this.log.error(`queue ${name}: ${e.message}`));
      this.queues.set(name, q);
    }
    return q;
  }

  /** Starts a worker for the queue (once). Returns null when workers are disabled in this process. */
  work<T>(name: string, processor: Processor<T>, opts: Partial<WorkerOptions> = {}): Worker<T> | null {
    if (!this.enabled) return null;
    const worker = new Worker<T>(name, processor, { connection: this.connection, prefix: QUEUE_PREFIX, concurrency: 5, ...opts });
    worker.on('failed', (job: Job<T> | undefined, e) => this.log.warn(`${name} job ${job?.name ?? '?'} (${job?.id ?? '?'}) failed, attempt ${job?.attemptsMade ?? '?'}: ${e.message}`));
    worker.on('error', (e) => this.log.error(`worker ${name}: ${e.message}`));
    this.workers.push(worker as Worker);
    return worker;
  }

  /** Waiting / active / delayed / failed counts for the console. */
  async counts(name: string) {
    return this.queue(name).getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
