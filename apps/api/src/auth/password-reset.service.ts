import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';

export const RESET_TTL_MINUTES = 30;

export type ResetSubject = { scope: 'school'; schoolId: string; userId: string } | { scope: 'platform'; adminId: string };

const subjectKey = (s: ResetSubject) => (s.scope === 'school' ? `school:${s.schoolId}:${s.userId}` : `platform:${s.adminId}`);
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Password-reset links: a random 256-bit token, stored only as its SHA-256 in Redis for 30 minutes.
 * It works once, and only the newest link of an account works (asking again voids older ones).
 */
@Injectable()
export class PasswordResetService {
  constructor(private readonly redis: RedisService) {}

  async create(subject: ResetSubject): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = digest(token);
    const ttl = RESET_TTL_MINUTES * 60;
    await this.redis.multi().set(`pwreset:${hash}`, JSON.stringify(subject), 'EX', ttl).set(`pwreset:latest:${subjectKey(subject)}`, hash, 'EX', ttl).exec();
    return token;
  }

  /** Redeems the token and returns whose password may now be set. */
  async consume(token: string): Promise<ResetSubject> {
    const hash = digest(token);
    const raw = await this.redis.getdel(`pwreset:${hash}`);
    if (!raw) throw new BadRequestException('This reset link has expired or was already used. Ask for a new one.');
    const subject = JSON.parse(raw) as ResetSubject;
    const latest = await this.redis.getdel(`pwreset:latest:${subjectKey(subject)}`);
    if (latest !== hash) throw new BadRequestException('A newer reset link was sent. Use the latest email.');
    return subject;
  }

  /** Whether a token is still valid (for the reset page to say so before the person types). */
  async peek(token: string): Promise<boolean> {
    return (await this.redis.exists(`pwreset:${digest(token)}`)) === 1;
  }
}
