import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentAuth, Public, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { ONLINE_METHODS, type OnlineMethod } from './gateway.js';
import { PaymentsService } from './payments.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;

class CheckoutDto {
  @IsString() @MaxLength(40) tierCode: string;
  @IsIn(['monthly', 'annual']) billingCycle: 'monthly' | 'annual';
}

/** What the test checkout page sends: never a card number, only the outcome and display details. */
class SandboxPayDto {
  @IsIn(ONLINE_METHODS) method: OnlineMethod;
  @IsIn(['success', 'decline']) outcome: 'success' | 'decline';
  @IsOptional() @IsIn(['Visa', 'Mastercard', 'UnionPay']) cardBrand?: string;
  @IsOptional() @Matches(/^\d{4}$/) last4?: string;
  @IsOptional() @IsString() @MaxLength(120) payerName?: string;
}

/** School side: open a checkout and follow its outcome (under /billing, so it works while locked). */
@Controller('billing')
export class SchoolPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequireAccess('settings', ['crud']) @Post('checkout')
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkout(@CurrentAuth() a: SchoolAuth, @Body() dto: CheckoutDto) {
    return this.payments.checkout(a.schoolId, a.userId, dto.tierCode, dto.billingCycle);
  }

  /** The own-domain add-on (one year, owner's price). */
  @RequireAccess('settings', ['crud']) @Post('checkout-domain')
  @UseGuards(ThrottlerGuard) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkoutDomain(@CurrentAuth() a: SchoolAuth) {
    return this.payments.checkoutDomain(a.schoolId, a.userId);
  }

  @RequireAccess('settings', ['crud']) @Get('online-payments/:id')
  status(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.status(a.schoolId, id);
  }
}

/** Gateway side (public, no tenant): the checkout page and the server-to-server webhook. */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public')
export class GatewayController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('pay/:token') @Throttle({ default: { limit: 60, ttl: 60_000 } })
  session(@Param('token') token: string) {
    return this.payments.session(token);
  }

  @Post('pay/:token/complete') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sandboxPay(@Param('token') token: string, @Body() dto: SandboxPayDto) {
    return this.payments.sandboxPay(token, dto);
  }

  /** Signed notice from the gateway; verified against the exact raw body. */
  @Post('payments/webhook/:provider') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 120, ttl: 60_000 } })
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.payments.handleWebhook(provider, req.rawBody?.toString('utf8') ?? '', req.headers);
  }
}
