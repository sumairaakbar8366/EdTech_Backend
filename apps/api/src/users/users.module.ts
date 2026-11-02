import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { LeadershipController } from './leadership.controller.js';
import { LeadershipService } from './leadership.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [UsersController, LeadershipController],
  providers: [UsersService, LeadershipService],
  exports: [UsersService],
})
export class UsersModule {}
