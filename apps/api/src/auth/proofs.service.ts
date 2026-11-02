import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';

const TTL_SECONDS = 30 * 60;

export interface Proof {
  kind: 'email' | 'phone';
  /** The verified email (lower-case) or phone (E.164). */
  value: string;
  method: 'google' | 'email' | 'whatsapp' | 'sms';
}

/**
 * A short-lived receipt for a verified email or phone. The person proves the mailbox (a code, or
 * Google) or the phone (a WhatsApp code) first and is handed a random receipt; the registration
 * must present it, and it only works for the value that was proven, and only once.
 */
@Injectable()
export class ProofsService {
  constructor(private readonly redis: RedisService) {}

  async issue(proof: Proof): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await this.redis.set(`regproof:${token}`, JSON.stringify(proof), 'EX', TTL_SECONDS);
    return token;
  }

  /** Reads a receipt without using it up. Null when missing, expired or for something else. */
  async peek(token: string | undefined, kind: Proof['kind'], value: string): Promise<Proof | null> {
    if (!token) return null;
    const raw = await this.redis.get(`regproof:${token}`);
    if (!raw) return null;
    const p = JSON.parse(raw) as Proof;
    return p.kind === kind && p.value === value ? p : null;
  }

  /** Uses the receipts up. False when one was already used (a second submit with the same proof). */
  async consume(tokens: (string | undefined)[]): Promise<boolean> {
    let all = true;
    for (const t of tokens) if (t && (await this.redis.del(`regproof:${t}`)) === 0) all = false;
    return all;
  }

  /** Counts a failed attempt for a key; true once it is over the limit within the window. */
  async tooManyFailures(key: string, limit: number): Promise<boolean> {
    const n = Number((await this.redis.get(`regfail:${key}`)) ?? 0);
    return n >= limit;
  }

  async recordFailure(key: string, windowSeconds: number): Promise<void> {
    const k = `regfail:${key}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, windowSeconds);
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = `reglock:${key}`;
    if (!(await this.redis.set(k, '1', 'EX', 60, 'NX'))) throw new BadRequestException('This registration is already being processed. Wait a moment.');
    try {
      return await fn();
    } finally {
      await this.redis.del(k);
    }
  }
}
