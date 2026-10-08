import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { RedisService } from '../redis/redis.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

/** Minimal in-memory stand-in for the Redis commands the service uses. */
class FakeRedis {
  strings = new Map<string, string>();
  sets = new Map<string, Set<string>>();

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }
  async set(key: string, value: string, ...args: unknown[]) {
    if (args.includes('NX') && this.strings.has(key)) return null;
    this.strings.set(key, value);
    return 'OK';
  }
  async sadd(key: string, member: string) {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
    return 1;
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  async expire() {
    return 1;
  }
  async del(...keys: string[]) {
    for (const key of keys) {
      this.strings.delete(key);
      this.sets.delete(key);
    }
    return keys.length;
  }
  multi() {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = {
      set: (...a: [string, string, ...unknown[]]) => (ops.push(() => this.set(...a)), chain),
      sadd: (k: string, m: string) => (ops.push(() => this.sadd(k, m)), chain),
      expire: () => chain,
      exec: async () => {
        for (const op of ops) await op();
        return [];
      },
    };
    return chain;
  }
}

function service() {
  const redis = new FakeRedis();
  const config = { get: () => 30 } as unknown as ConfigService;
  return { redis, tokens: new RefreshTokenService(redis as unknown as RedisService, config as never) };
}

const subject = { scope: 'school' as const, sub: 'user-1', sid: 'school-1' };

describe('RefreshTokenService', () => {
  it('stores only a hash of the token', async () => {
    const { redis, tokens } = service();
    const token = await tokens.issue(subject);
    expect([...redis.strings.keys()].some((k) => k.includes(token))).toBe(false);
  });

  it('rotates: the new token works and carries the same subject', async () => {
    const { tokens } = service();
    const first = await tokens.issue(subject);
    const { subject: s, token: second } = await tokens.rotate(first);
    expect(s).toEqual(subject);
    expect(second).not.toBe(first);
    await expect(tokens.rotate(second)).resolves.toBeDefined();
  });

  it('detects reuse of a rotated token and revokes the whole session', async () => {
    const { tokens } = service();
    const first = await tokens.issue(subject);
    const { token: second } = await tokens.rotate(first);

    await expect(tokens.rotate(first)).rejects.toThrow(UnauthorizedException);
    // The legitimate newer token is revoked too, forcing a fresh login.
    await expect(tokens.rotate(second)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects unknown tokens and revokes on logout', async () => {
    const { tokens } = service();
    await expect(tokens.rotate('unknown')).rejects.toThrow(UnauthorizedException);
    const token = await tokens.issue(subject);
    await tokens.revoke(token);
    await expect(tokens.rotate(token)).rejects.toThrow(UnauthorizedException);
  });
});
