import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';

export type TokenSubject =
  | { scope: 'platform'; sub: string }
  | { scope: 'school'; sub: string; sid: string };

interface StoredToken {
  subject: TokenSubject;
  family: string;
}

/**
 * Opaque refresh tokens stored in Redis (blueprint: Redis for sessions).
 *
 * - Only a SHA-256 of each token is stored.
 * - Every refresh rotates the token; tokens from one login share a "family".
 * - Presenting an already-rotated token is treated as theft: the whole family
 *   (that login session) is revoked. This is reuse detection as recommended for
 *   OAuth 2.0 refresh token rotation.
 */
@Injectable()
export class RefreshTokenService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60;
  }

  get maxAgeSeconds(): number {
    return this.ttlSeconds;
  }

  async issue(subject: TokenSubject, family: string = randomUUID()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = sha256(token);
    const stored: StoredToken = { subject, family };
    await this.redis
      .multi()
      .set(tokenKey(hash), JSON.stringify(stored), 'EX', this.ttlSeconds)
      .sadd(familyKey(family), hash)
      .expire(familyKey(family), this.ttlSeconds)
      .sadd(subjectKey(subject), family)
      .expire(subjectKey(subject), this.ttlSeconds)
      .exec();
    return token;
  }

  /** Consumes `token` and returns its subject plus a replacement token. */
  async rotate(token: string): Promise<{ subject: TokenSubject; token: string }> {
    const hash = sha256(token);
    const raw = await this.redis.get(tokenKey(hash));
    if (!raw) throw new UnauthorizedException('Session expired');
    const stored = JSON.parse(raw) as StoredToken;

    // Atomic claim: exactly one caller may consume a given token.
    const claimed = await this.redis.set(usedKey(hash), '1', 'EX', this.ttlSeconds, 'NX');
    if (claimed !== 'OK') {
      await this.revokeFamily(stored.family);
      throw new UnauthorizedException('Session expired');
    }

    const next = await this.issue(stored.subject, stored.family);
    return { subject: stored.subject, token: next };
  }

  /** Ends the login session the token belongs to. Unknown tokens are ignored. */
  async revoke(token: string): Promise<void> {
    const raw = await this.redis.get(tokenKey(sha256(token)));
    if (!raw) return;
    await this.revokeFamily((JSON.parse(raw) as StoredToken).family);
  }

  /** Ends every login session of a user (password reset, password change). */
  async revokeAllFor(subject: TokenSubject): Promise<void> {
    const families = await this.redis.smembers(subjectKey(subject));
    for (const family of families) await this.revokeFamily(family);
    await this.redis.del(subjectKey(subject));
  }

  async revokeFamily(family: string): Promise<void> {
    const hashes = await this.redis.smembers(familyKey(family));
    const keys = hashes.flatMap((h) => [tokenKey(h), usedKey(h)]);
    await this.redis.del(familyKey(family), ...keys);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
const tokenKey = (hash: string) => `auth:rt:${hash}`;
const usedKey = (hash: string) => `auth:rt-used:${hash}`;
const familyKey = (family: string) => `auth:rt-family:${family}`;
const subjectKey = (s: TokenSubject) => (s.scope === 'school' ? `auth:rt-user:${s.sid}:${s.sub}` : `auth:rt-admin:${s.sub}`);
