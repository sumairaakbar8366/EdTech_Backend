import { Global, Module } from '@nestjs/common';
import { QueuesService } from './queues.service.js';
import { SchedulerService } from './scheduler.service.js';

/** Background work on BullMQ (Redis): queues, workers and cron-style scheduled jobs. */
@Global()
@Module({
  providers: [QueuesService, SchedulerService],
  exports: [QueuesService, SchedulerService],
})
export class JobsModule {}
