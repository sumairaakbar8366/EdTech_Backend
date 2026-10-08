import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BillingController, PlatformBillingController, PublicPlansController, SubscriptionController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { EntitlementGuard } from './entitlement.guard.js';
import { SubscriptionStateService } from './subscription-state.service.js';

/** Plans, payments and the plan/read-only guard (registered after the auth guards). */
@Global()
@Module({
  controllers: [PublicPlansController, SubscriptionController, BillingController, PlatformBillingController],
  providers: [SubscriptionStateService, BillingService, { provide: APP_GUARD, useClass: EntitlementGuard }],
  exports: [SubscriptionStateService],
})
export class BillingModule {}
