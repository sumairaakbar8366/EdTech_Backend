import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentAuth, Public, RequireAccess } from '../auth/decorators.js';
import type { AppRequest, AuthContext } from '../common/request-context.js';
import { AccessEmailDto, AccessEmailVerifyDto, AccessGoogleDto, AccessRequestDto, ApproveAccessDto, RejectAccessDto } from './access.dto.js';
import { AccessService } from './access.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;

function school(req: AppRequest): { id: string; name: string } {
  if (req.tenant?.kind !== 'school') throw new Error('Not a school address');
  return { id: req.tenant.schoolId, name: req.tenant.name };
}

/** A school's "Request access" page: no sign-in; the school comes from the address. */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/access')
export class AccessPublicController {
  constructor(private readonly access: AccessService) {}

  @Get('form') @Throttle({ default: { limit: 60, ttl: 60_000 } })
  form(@Req() req: AppRequest) {
    const s = school(req);
    return this.access.publicForm(s.id, s.name);
  }

  @Post('email-code') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  code(@Req() req: AppRequest, @Body() dto: AccessEmailDto) {
    const s = school(req);
    return this.access.sendEmailCode(s.id, s.name, dto.email);
  }

  @Post('email-verify') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Req() req: AppRequest, @Body() dto: AccessEmailVerifyDto) {
    return this.access.verifyEmail(school(req).id, dto);
  }

  @Post('google') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  google(@Body() dto: AccessGoogleDto) {
    return this.access.verifyGoogle(dto);
  }

  @Post('request') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  request(@Req() req: AppRequest, @Body() dto: AccessRequestDto) {
    return this.access.submit(school(req).id, dto);
  }
}

/** Users & Access (school admin): decide who gets a login. */
@Controller('access-requests')
export class AccessAdminController {
  constructor(private readonly access: AccessService) {}

  @RequireAccess('settings', ['crud']) @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query('status') status?: string) {
    return this.access.list(a.schoolId, status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined);
  }

  @RequireAccess('settings', ['crud']) @Get(':id/matches')
  matches(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.access.matches(a.schoolId, id);
  }

  @RequireAccess('settings', ['crud']) @Post(':id/approve') @HttpCode(HttpStatus.OK)
  approve(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveAccessDto) {
    return this.access.approve(a.schoolId, a.userId, id, dto);
  }

  @RequireAccess('settings', ['crud']) @Post(':id/reject') @HttpCode(HttpStatus.OK)
  reject(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectAccessDto) {
    return this.access.reject(a.schoolId, a.userId, id, dto.note);
  }
}
