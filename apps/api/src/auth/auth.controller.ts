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
import { ChangePasswordDto, LoginDto } from './login.dto.js';

const REFRESH_COOKIE = 'schoolerp_rt';
const REFRESH_COOKIE_PATH = '/api/auth';

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
    const tokens = await this.auth.login(req.tenant!, dto.email, dto.password);
    return this.respond(res, tokens, dto.remember === true);
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
    const base = { httpOnly: true, secure: this.secureCookies, sameSite: 'strict' as const, path: REFRESH_COOKIE_PATH };
    const lifetime = remember ? { maxAge: this.auth.refreshMaxAgeSeconds * 1000 } : {};
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base, ...lifetime });
    res.cookie(REMEMBER_COOKIE, remember ? '1' : '0', { ...base, ...lifetime });
    res.setHeader('Cache-Control', 'no-store');
    return { accessToken: tokens.accessToken, tokenType: 'Bearer', expiresIn: tokens.expiresIn };
  }

  private clearCookie(res: Response): void {
    const base = { httpOnly: true, secure: this.secureCookies, sameSite: 'strict' as const, path: REFRESH_COOKIE_PATH };
    res.clearCookie(REFRESH_COOKIE, base);
    res.clearCookie(REMEMBER_COOKIE, base);
  }
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
