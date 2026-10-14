import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export const SOCIAL_PROVIDERS = ['google'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** The verified identity "Continue with Google" yields: only the email and name. */
export interface SocialIdentity {
  email: string;
  firstName: string;
  lastName: string;
}

const NOT_ACCEPTED = 'The sign-in was not accepted. Please try again.';

/**
 * Verifies the ID token "Continue with Google" returns (OpenID Connect, implicit id_token):
 * issued for this app, unexpired, for the nonce this browser chose, and carrying an email the
 * provider has verified. No mailbox or contacts access is ever requested.
 */
@Injectable()
export class SocialIdentityService {
  private readonly log = new Logger(SocialIdentityService.name);
  readonly clientIds: Record<SocialProvider, string | null>;

  constructor(config: ConfigService<Env, true>) {
    this.clientIds = { google: config.get('GOOGLE_CLIENT_ID', { infer: true })?.trim() || null };
  }

  async verify(provider: SocialProvider, idToken: string, nonce: string): Promise<SocialIdentity> {
    const clientId = this.clientIds[provider];
    if (!clientId) throw new BadRequestException('Google sign-in is not set up on this server');
    return this.google(clientId, idToken, nonce);
  }

  private async google(clientId: string, idToken: string, nonce: string): Promise<SocialIdentity> {
    // Google checks the signature and expiry; we check audience, issuer, nonce and the email.
    const info = await this.fetchJson<Record<string, unknown>>(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, true);
    const issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    if (info.aud !== clientId || !issuerOk || Number(info.exp ?? 0) * 1000 <= Date.now() || info.nonce !== nonce) throw new UnauthorizedException(NOT_ACCEPTED);
    const verified = info.email_verified === true || info.email_verified === 'true';
    if (typeof info.email !== 'string' || !verified) throw new UnauthorizedException('Your Google account has no verified email address.');
    return this.identity(info.email, info.given_name, info.family_name, info.name);
  }

  private async fetchJson<T>(url: string, badRequestIsRejection: boolean): Promise<T> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (badRequestIsRejection && res.status === 400) throw new UnauthorizedException(NOT_ACCEPTED);
      if (!res.ok) throw new Error(`${url.split('?')[0]} answered ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      this.log.error(`identity provider unreachable: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Google could not be reached. Please try again or use your email.');
    }
  }

  private identity(email: string, given: unknown, family: unknown, full: unknown): SocialIdentity {
    const [first = '', ...rest] = (typeof full === 'string' ? full : '').trim().split(/\s+/);
    return {
      email: email.trim().toLowerCase(),
      firstName: (typeof given === 'string' && given.trim() ? given : first).trim().slice(0, 100) || 'School',
      lastName: (typeof family === 'string' && family.trim() ? family : rest.join(' ')).trim().slice(0, 100) || 'Admin',
    };
  }
}
