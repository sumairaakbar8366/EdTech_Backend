import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentAuth, PlatformOnly, Public } from '../../auth/decorators.js';
import type { AppRequest, AuthContext } from '../../common/request-context.js';
import { ApproveApplicationDto, ChecklistDto, RegEmailCodeDto, RegEmailVerifyDto, RegGoogleDto, RegisterSchoolDto, RegPhoneCodeDto, RegPhoneVerifyDto, RejectApplicationDto, SaveRegistrationFormDto } from './registration.dto.js';
import { RegistrationService } from './registration.service.js';

/** The public "Apply to join" process: prove your email, give the owner's and school's details, and wait for the team. */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/registration')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Get('form') @Throttle({ default: { limit: 60, ttl: 60_000 } })
  form() { return this.registration.publicForm(); }

  @Post('email-code') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  emailCode(@Body() dto: RegEmailCodeDto) { return this.registration.sendEmailCode(dto.email); }

  @Post('email-verify') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  emailVerify(@Body() dto: RegEmailVerifyDto) { return this.registration.verifyEmail(dto); }

  @Post('google') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  google(@Body() dto: RegGoogleDto) { return this.registration.verifyGoogle(dto); }

  @Post('phone-code') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  phoneCode(@Body() dto: RegPhoneCodeDto) { return this.registration.sendPhoneCode(dto); }

  @Post('phone-verify') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  phoneVerify(@Body() dto: RegPhoneVerifyDto) { return this.registration.verifyPhone(dto); }

  @Post() @Throttle({ default: { limit: 4, ttl: 60_000 } })
  register(@Body() dto: RegisterSchoolDto, @Req() req: AppRequest) { return this.registration.register(dto, { ip: req.ip, userAgent: req.headers['user-agent'] }); }
}

type PlatformAuth = Extract<AuthContext, { scope: 'platform' }>;

/** Owner console: the form and rules, and every application with the team's checklist and the decision. */
@Controller('platform/registration')
export class RegistrationAdminController {
  constructor(private readonly registration: RegistrationService) {}

  @PlatformOnly() @Get('form') form() { return this.registration.ownerForm(); }
  @PlatformOnly() @Put('form') saveForm(@CurrentAuth() a: PlatformAuth, @Body() dto: SaveRegistrationFormDto) { return this.registration.saveOwnerForm(dto, a.adminId); }

  @PlatformOnly() @Get('applications')
  applications(@Query('status') status?: string, @Query('q') q?: string, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1, @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20) {
    return this.registration.applications({ status: status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined, q: q?.trim() || undefined, page: Math.max(1, page), pageSize: Math.min(100, Math.max(1, pageSize)) });
  }

  /** Reveals the full CNIC to the verifying team, only while the application waits. */
  @PlatformOnly() @Get('applications/:id/nic') nic(@Param('id', ParseUUIDPipe) id: string) { return this.registration.nic(id); }

  @PlatformOnly() @Put('applications/:id/checklist') checklist(@CurrentAuth() a: PlatformAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChecklistDto) { return this.registration.saveChecklist(id, dto, a.adminId); }
  @PlatformOnly() @Post('applications/:id/approve') @HttpCode(HttpStatus.OK) approve(@CurrentAuth() a: PlatformAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveApplicationDto) { return this.registration.approve(id, dto, a.adminId); }
  @PlatformOnly() @Post('applications/:id/reject') @HttpCode(HttpStatus.OK) reject(@CurrentAuth() a: PlatformAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectApplicationDto) { return this.registration.reject(id, dto.reason, a.adminId); }
}
