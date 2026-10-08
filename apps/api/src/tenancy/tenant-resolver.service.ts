import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveHost, type HostConfig } from '@schoolerp/shared';
import type { Env } from '../config/env.js';
import type { TenantContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type ResolvedTenant =
  | { kind: 'platform' }
  | { kind: 'school'; schoolId: string; slug: string; name: string; status: 'active' | 'suspended' };

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 5_000;

/**
 * Maps a request host to a tenant (page 2: Domain / Tenant Resolution).
 * <slug>.<BASE_DOMAIN> resolves by school slug, PLATFORM_HOST is the platform
 * console, and any other host must be a verified custom domain.
 *
 * Results (including misses) are cached in-process for 30 seconds.
 */
@Injectable()
export class TenantResolverService {
  private readonly hostConfig: HostConfig;
  private readonly cache = new Map<string, { value: ResolvedTenant | null; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.hostConfig = {
      baseDomain: config.get('BASE_DOMAIN', { infer: true }).toLowerCase(),
      platformHost: config.get('PLATFORM_HOST', { infer: true }).toLowerCase(),
    };
  }

  async resolve(host: string | undefined): Promise<ResolvedTenant | null> {
    const resolution = resolveHost(host, this.hostConfig);
    if (!resolution) return null;
    if (resolution.kind === 'platform') return { kind: 'platform' };

    const cacheKey = resolution.kind === 'subdomain' ? `s:${resolution.slug}` : `d:${resolution.hostname}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const school =
      resolution.kind === 'subdomain'
        ? await this.prisma.school.findUnique({ where: { slug: resolution.slug } })
        : (
            await this.prisma.domain.findFirst({
              where: { hostname: resolution.hostname, verifiedAt: { not: null } },
              include: { school: true },
            })
          )?.school;

    const value: ResolvedTenant | null = school
      ? { kind: 'school', schoolId: school.id, slug: school.slug, name: school.name, status: school.status }
      : null;

    if (this.cache.size >= CACHE_MAX_ENTRIES) this.cache.clear();
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /** Drop cached lookups after a school's slug, status or domains change. */
  invalidate(): void {
    this.cache.clear();
  }

  static toContext(resolved: Extract<ResolvedTenant, { kind: 'school' }>): TenantContext {
    return { kind: 'school', schoolId: resolved.schoolId, slug: resolved.slug, name: resolved.name };
  }
}
