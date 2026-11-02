import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../auth/decorators.js';
import { SignupService } from './signup.service.js';

/** What the sign-in and registration screens may offer. Registration itself is in /public/registration. */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/signup')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Get('config')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  config() {
    return this.signup.publicConfig();
  }
}
