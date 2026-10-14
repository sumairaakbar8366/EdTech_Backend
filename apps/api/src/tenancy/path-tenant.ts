import type { NextFunction, Request, Response } from 'express';
import { SCHOOL_SLUG_PATTERN } from '@schoolerp/shared';

/**
 * Path-based tenants on the main domain. The web app calls a school's API at /api/s/<slug>/…
 * and the platform console's at /api/console/…; this runs before Nest routes and turns those
 * into the usual /api/… paths, remembering the tenant (and the prefix, for the session cookie's
 * path). Requests to plain /api/… keep host-based resolution (a school's verified own domain).
 */
export type PathTenant = { kind: 'school'; slug: string } | { kind: 'platform' };

export interface PathTenantRequest extends Request {
  pathTenant?: PathTenant;
  /** "/api/s/demo", "/api/console" or "/api": where this tenant's API lives for the browser. */
  apiBase?: string;
}

const SCHOOL = /^\/api\/s\/([^/?#]+)(\/[^?#]*)?(\?.*)?$/;
const CONSOLE = /^\/api\/console(\/[^?#]*)?(\?.*)?$/;

export function pathTenantMiddleware(req: PathTenantRequest, _res: Response, next: NextFunction): void {
  req.apiBase = '/api';
  const school = SCHOOL.exec(req.url);
  if (school) {
    const slug = decodeURIComponent(school[1]!).toLowerCase();
    if (SCHOOL_SLUG_PATTERN.test(slug)) {
      req.pathTenant = { kind: 'school', slug };
      req.apiBase = `/api/s/${slug}`;
      req.url = `/api${school[2] ?? '/'}${school[3] ?? ''}`;
    }
    return next();
  }
  const consoleMatch = CONSOLE.exec(req.url);
  if (consoleMatch) {
    req.pathTenant = { kind: 'platform' };
    req.apiBase = '/api/console';
    req.url = `/api${consoleMatch[1] ?? '/'}${consoleMatch[2] ?? ''}`;
  }
  next();
}

/** The request's API path without the tenant prefix: "/students/1" for /api/s/demo/students/1. */
export function apiPath(req: PathTenantRequest): string {
  const full = (req.originalUrl ?? req.url).split('?')[0]!;
  const base = req.apiBase ?? '/api';
  return full.startsWith(base) ? full.slice(base.length) || '/' : full.replace(/^\/api/, '');
}
