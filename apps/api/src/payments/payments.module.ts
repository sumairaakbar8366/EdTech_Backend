import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { GatewayController, SchoolPaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/** Online subscription payments (gateway checkout + webhook). */
@Module({
  imports: [BillingModule],
  controllers: [SchoolPaymentsController, GatewayController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
