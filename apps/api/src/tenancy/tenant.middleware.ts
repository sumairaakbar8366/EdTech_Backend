import { ForbiddenException, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Response } from 'express';
import type { Env } from '../config/env.js';
import type { AppRequest } from '../common/request-context.js';
import { TenantResolverService } from './tenant-resolver.service.js';

/** Resolves the tenant for every request before guards run: from the path, else the host. Unknown ones get 404. */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly trustProxy: boolean;

  constructor(
    private readonly resolver: TenantResolverService,
    config: ConfigService<Env, true>,
  ) {
    this.trustProxy = config.get('TRUST_PROXY', { infer: true });
  }

  async use(req: AppRequest, _res: Response, next: NextFunction): Promise<void> {
    // On the main domain the tenant is in the path (/api/s/<slug>, /api/console); see path-tenant.ts.
    const fromPath = req.pathTenant;
    const forwarded = this.trustProxy ? req.headers['x-forwarded-host'] : undefined;
    const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]) ?? req.headers.host;

    const resolved = fromPath ? (fromPath.kind === 'platform' ? { kind: 'platform' as const } : await this.resolver.resolveSlug(fromPath.slug)) : await this.resolver.resolve(host);
    if (!resolved) throw new NotFoundException('Unknown school');

    if (resolved.kind === 'school') {
      if (resolved.status !== 'active') throw new ForbiddenException('This school account is suspended');
      req.tenant = TenantResolverService.toContext(resolved);
    } else {
      req.tenant = { kind: 'platform' };
    }
    next();
  }
}
