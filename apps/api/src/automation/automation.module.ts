import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module.js';
import { AutomationService } from './automation.service.js';

/** Scheduled jobs: fee-overdue reminders, trial / plan expiry notices, weekly reports. */
@Module({
  imports: [FeesModule],
  providers: [AutomationService],
})
export class AutomationModule {}
