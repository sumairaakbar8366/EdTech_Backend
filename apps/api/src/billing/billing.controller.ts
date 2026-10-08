import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentAuth, PlatformOnly, Public, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { BillingService, BillingSettingsDto, ReviewPaymentDto, SubmitPaymentDto } from './billing.service.js';
import { SubscriptionStateService } from './subscription-state.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
type PlatformAuth = Extract<AuthContext, { scope: 'platform' }>;

/** Anyone (the marketing page): the active plans with their current prices and features. */
@Public()
@Controller('public/plans')
export class PublicPlansController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  list() {
    return this.billing.publicPlans();
  }
}

/** Any signed-in school user: plan state (banners, locked features). */
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly state: SubscriptionStateService) {}

  @Get()
  get(@CurrentAuth() a: SchoolAuth) {
    return this.state.get(a.schoolId);
  }
}

/** School admin: plans, the platform bank account, submitting a payment. */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @RequireAccess('settings', ['crud']) @Get()
  overview(@CurrentAuth() a: SchoolAuth) {
    return this.billing.overview(a.schoolId);
  }

  @RequireAccess('settings', ['crud']) @Post('payments')
  submit(@CurrentAuth() a: SchoolAuth, @Body() dto: SubmitPaymentDto) {
    return this.billing.submit(a.schoolId, a.userId, dto);
  }
}

/** Platform owner: incoming payments, confirmation, bank details and plan prices. */
@PlatformOnly()
@Controller('platform')
export class PlatformBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('payments')
  payments(@Query('status') status?: string) {
    return this.billing.listPayments(status);
  }

  @Get('payments/summary')
  summary() {
    return this.billing.summary();
  }

  @Post('payments/:id/confirm') @HttpCode(HttpStatus.OK)
  confirm(@CurrentAuth() a: PlatformAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewPaymentDto) {
    return this.billing.confirm(a.adminId, id, dto);
  }

  @Post('payments/:id/reject') @HttpCode(HttpStatus.OK)
  reject(@CurrentAuth() a: PlatformAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewPaymentDto) {
    return this.billing.reject(a.adminId, id, dto);
  }

  @Get('billing-settings')
  settings() {
    return this.billing.bankSettings();
  }

  @Put('billing-settings')
  saveSettings(@Body() dto: BillingSettingsDto) {
    return this.billing.saveBankSettings(dto);
  }
}
