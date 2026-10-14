import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { AuthController, SocialSignInController, UniversalLoginController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessGuard, AuthGuard } from './guards.js';
import { SocialIdentityService } from './social-identity.service.js';
import { PasswordService } from './password.service.js';
import { LoginEventsService } from './login-events.service.js';
import { LoginTicketService } from './login-ticket.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { VerificationCodesService } from './verification-codes.service.js';

@Module({
  imports: [
    RbacModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
          issuer: 'schoolerp',
          audience: 'schoolerp-api',
        },
        verifyOptions: { algorithms: ['HS256'], issuer: 'schoolerp', audience: 'schoolerp-api' },
      }),
    }),
  ],
  controllers: [AuthController, SocialSignInController, UniversalLoginController],
  providers: [
    AuthService,
    PasswordService,
    RefreshTokenService,
    VerificationCodesService,
    PasswordResetService,
    LoginTicketService,
    LoginEventsService,
    SocialIdentityService,
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [PasswordService, AuthService, VerificationCodesService, LoginTicketService, LoginEventsService, SocialIdentityService],
})
export class AuthModule {}
