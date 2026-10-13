import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../auth/decorators.js';
import { SignupCodeDto, SignupDto } from './signup.dto.js';
import { SignupService } from './signup.service.js';

/** Public sign-up on the marketing site (no tenant). */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/signup')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Get('slug')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  slug(@Query('slug') slug = '') {
    return this.signup.checkSlug(slug);
  }

  /** Step 1: a 6-digit code to the admin's email. */
  @Post('code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  code(@Body() dto: SignupCodeDto) {
    return this.signup.sendCode(dto.email);
  }

  /** Step 2: with the code, the school is created on a free trial. */
  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  create(@Body() dto: SignupDto) {
    return this.signup.signup(dto);
  }
}
