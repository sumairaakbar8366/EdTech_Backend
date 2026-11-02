import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';

/** Wrong passwords allowed per account in the window before it is paused. */
const LIMIT = 10;
const WINDOW_SECONDS = 15 * 60;

/**
 * Slows down password guessing on one account, however many addresses the guesses come from (the
 * per-address limit alone cannot stop a spread-out attack). After 10 wrong passwords for the same
 * sign-in name the account is paused for 15 minutes; a correct sign-in before that resets the count.
 * The answer never says whether the account exists.
 */
@Injectable()
export class LoginLockService {
  constructor(private readonly redis: RedisService) {}

  private key(identifier: string) {
    return `loginfail:${createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex').slice(0, 32)}`;
  }

  async assertOpen(identifier: string): Promise<void> {
    const n = Number((await this.redis.get(this.key(identifier))) ?? 0);
    if (n >= LIMIT) throw new HttpException('Too many wrong passwords. Wait 15 minutes, or use “Forgot password”.', HttpStatus.TOO_MANY_REQUESTS);
  }

  async fail(identifier: string): Promise<void> {
    const k = this.key(identifier);
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, WINDOW_SECONDS);
  }

  async clear(identifier: string): Promise<void> {
    await this.redis.del(this.key(identifier));
  }
}
