import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Env } from '../config/env.js';
import type { AppRequest, AuthContext } from '../common/request-context.js';
import { AuthService, type IssuedTokens } from './auth.service.js';
import { AllowPendingPassword, CurrentAuth, Public } from './decorators.js';
import { ChangePasswordDto, ForgotPasswordDto, ForgotUserIdDto, LoginDto, ResetPasswordDto, ResetTokenDto, SendEmailCodeDto, SocialTicketDto, TicketDto, UniversalLoginDto, VerifyEmailCodeDto } from './login.dto.js';

const REFRESH_COOKIE = 'schoolerp_rt';
/** The session cookie lives under this tenant's API ("/api/s/demo/auth", "/api/console/auth" or
 * "/api/auth" on a school's own domain), so each school and the console keep their own sign-in. */
const refreshCookiePath = (res: Response) => `${(res.req as AppRequest).apiBase ?? '/api'}/auth`;

/**
 * Access token: short-lived JWT returned in the body, kept in memory by the client.
 * Refresh token: opaque, rotating, in an httpOnly SameSite=Strict cookie scoped to
 * this host (no Domain attribute), so each school's session stays on its own host.
 */
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookies = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() req: AppRequest, @Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(req.tenant!, dto.identifier, dto.password, loginContext(req));
    return this.respond(res, tokens, dto.remember === true);
  }

  /** One-time ticket from sign-up (or a support hand-over) → a session on this school's host. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  async ticket(@Req() req: AppRequest, @Body() dto: TicketDto, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const tokens = await this.auth.exchangeTicket(req.tenant!, dto.ticket, loginContext(req));
    return this.respond(res, tokens, tokens.remember === true);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedException('Session expired');
    try {
      // A rotated token keeps the persistence chosen at sign-in.
      return this.respond(res, await this.auth.refresh(req.tenant!, token), req.cookies?.[REMEMBER_COOKIE] === '1');
    } catch (error) {
      this.clearCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    assertCsrfHeader(req);
    const token = readRefreshCookie(req);
    if (token) await this.auth.logout(token);
    this.clearCookie(res);
  }

  /** Replaces the password (required after an administrator issued or reset it). */
  @AllowPendingPassword()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Req() req: AppRequest, @CurrentAuth() auth: AuthContext, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    assertCsrfHeader(req);
    const tokens = await this.auth.changePassword(auth, dto.currentPassword, dto.newPassword);
    return this.respond(res, tokens, req.cookies?.[REMEMBER_COOKIE] === '1');
  }

  /** Emails a reset link (school: by User ID; platform: by email). Same answer whether or not it exists. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Req() req: AppRequest, @Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(req.tenant!, dto.identifier);
    return { message: 'If that account exists, a reset link is on its way to its email. No email on file? Your school admin has been told and can reset it for you.' };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('reset-password/check')
  @HttpCode(HttpStatus.OK)
  checkReset(@Body() dto: ResetTokenDto) {
    return this.auth.checkResetToken(dto.token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Req() req: AppRequest, @Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(req.tenant!, dto.token, dto.newPassword);
  }

  /** Emails the User IDs registered with a verified email at this school. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-user-id')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotUserId(@Req() req: AppRequest, @Body() dto: ForgotUserIdDto) {
    await this.auth.forgotUserId(req.tenant!, dto.email);
    return { message: 'If accounts use that email, their User IDs are on their way.' };
  }

  /** Sends a 6-digit code to verify the signed-in user's email (or a new one). */
  @AllowPendingPassword()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('email/code')
  @HttpCode(HttpStatus.OK)
  sendEmailCode(@Req() req: AppRequest, @CurrentAuth() auth: AuthContext, @Body() dto: SendEmailCodeDto) {
    return this.auth.sendEmailCode(auth, req.tenant!, dto.email);
  }

  @AllowPendingPassword()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyEmailCodeDto) {
    return this.auth.verifyEmailCode(auth, dto.verificationId, dto.code);
  }

  @AllowPendingPassword()
  @Get('me')
  me(@Req() req: AppRequest, @CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth, req.tenant!);
  }

  /**
   * Without "remember me" the refresh cookie has no expiry, so the browser drops it when it
   * closes and the next visit starts at the login page. A small flag cookie remembers the choice.
   */
  private respond(res: Response, tokens: IssuedTokens, remember: boolean) {
    // Owner support sessions carry no refresh token: they end with the access token (1 hour).
    if (!tokens.refreshToken) {
      res.setHeader('Cache-Control', 'no-store');
      return { accessToken: tokens.accessToken, tokenType: 'Bearer', expiresIn: tokens.expiresIn };
    }
    const base = { httpOnly: true, secure: this.secureCookies, sameSite: 'strict' as const, path: refreshCookiePath(res) };
    const lifetime = remember ? { maxAge: this.auth.refreshMaxAgeSeconds * 1000 } : {};
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, ...lifetime });
    res.cookie(REMEMBER_COOKIE, remember ? '1' : '0', { ...base, ...lifetime });
    res.setHeader('Cache-Control', 'no-store');
    return { accessToken: tokens.accessToken, tokenType: 'Bearer', expiresIn: tokens.expiresIn };
  }

  private clearCookie(res: Response): void {
    const base = { httpOnly: true, secure: this.secureCookies, sameSite: 'strict' as const, path: refreshCookiePath(res) };
    res.clearCookie(REFRESH_COOKIE, base);
    res.clearCookie(REMEMBER_COOKIE, base);
  }
}

/** Who is signing in from where, for the login history (the client IP honours TRUST_PROXY). */
function loginContext(req: AppRequest) {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null };
}

/** Whether the session was started with "remember me". */
const REMEMBER_COOKIE = 'schoolerp_remember';

function readRefreshCookie(req: AppRequest): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Cookie-authenticated endpoints require a custom header. Browsers only send custom
 * headers cross-origin after a CORS preflight, which this API never grants, so
 * other sites (including sibling school subdomains) cannot trigger these requests.
 */
function assertCsrfHeader(req: AppRequest): void {
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    throw new ForbiddenException('Missing X-Requested-With header');
  }
}

/** "Continue with Google" for a school's sign-in, completed on the main site. */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/social')
export class SocialSignInController {
  constructor(private readonly auth: AuthService) {}

  /** Google's ID token → a one-time link into the person's school (2 minutes), or schools to choose from. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  ticket(@Req() req: AppRequest, @Body() dto: SocialTicketDto) {
    return this.auth.providerTicket(dto.school, dto.provider, dto.credential, dto.nonce, loginContext(req));
  }
}

/** The main domain's single /login for the owner and every school user. */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/login')
export class UniversalLoginController {
  constructor(private readonly auth: AuthService) {}

  /** A one-time link into the matching account, or the schools to choose from. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.OK)
  login(@Req() req: AppRequest, @Body() dto: UniversalLoginDto) {
    return this.auth.universalLogin(dto.identifier, dto.password, dto.school, loginContext(req), dto.remember === true);
  }
}
