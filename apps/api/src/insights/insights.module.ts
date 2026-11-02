import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { ComplaintsModule } from '../complaints/complaints.module.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({ imports: [BillingModule, ComplaintsModule], controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
