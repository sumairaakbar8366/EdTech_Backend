import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { BillingService } from './billing.service.js';
import { FeeSetupService } from './fee-setup.service.js';
import { FeesController } from './fees.controller.js';

@Module({
  imports: [RbacModule],
  controllers: [FeesController],
  providers: [FeeSetupService, BillingService],
  exports: [BillingService],
})
export class FeesModule {}
