import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';

const TTL_SECONDS = 120;

export interface LoginTicket {
  /** The school; empty for a platform-console sign-in ("platform"). */
  schoolId: string;
  /** The school user; for "platform" the platform admin's id. */
  userId: string;
  /**
   * "signup": the new admin continues on their school's site. "support": the platform owner opens a
   * school. "google" / "login": a sign-in on the main site's /login (Google or password), continued in
   * the school. "platform": the owner signed in on /login, continued in the console.
   */
  purpose: 'signup' | 'support' | 'google' | 'login' | 'platform';
  /** "Keep me signed in" chosen on the main /login. */
  remember?: boolean;
  /** For support sessions: the platform admin acting. */
  platformAdminId?: string;
}

const key = (token: string) => `login-ticket:${createHash('sha256').update(token).digest('hex')}`;

/**
 * One-time sign-in tickets that carry a session across hosts: sessions live in cookies scoped to
 * each school's own host, so the marketing site (sign-up) and the platform console (support) hand
 * over a 2-minute, single-use ticket that the school's site exchanges for a session.
 */
@Injectable()
export class LoginTicketService {
  constructor(private readonly redis: RedisService) {}

  async create(ticket: LoginTicket): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(key(token), JSON.stringify(ticket), 'EX', TTL_SECONDS);
    return token;
  }

  async consume(token: string): Promise<LoginTicket> {
    const raw = await this.redis.getdel(key(token));
    if (!raw) throw new BadRequestException('This sign-in link has expired or was already used. Please sign in with your User ID.');
    return JSON.parse(raw) as LoginTicket;
  }
}
