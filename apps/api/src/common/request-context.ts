import type { Request } from 'express';
import type { PathTenant } from '../tenancy/path-tenant.js';

export type TenantContext =
  | { kind: 'platform' }
  | { kind: 'school'; schoolId: string; slug: string; name: string };

export type AuthContext =
  | { scope: 'platform'; adminId: string }
  /** `support`: the platform owner working inside the school ("Open as admin"), shown and audited as such. */
  | { scope: 'school'; userId: string; schoolId: string; support?: { adminId: string; name: string } };

export interface AppRequest extends Request {
  tenant?: TenantContext;
  /** Set by pathTenantMiddleware for /api/s/<slug>/… and /api/console/… requests. */
  pathTenant?: PathTenant;
  /** Where this tenant's API lives for the browser ("/api/s/demo"); the session cookie's path. */
  apiBase?: string;
  auth?: AuthContext;
  /** Permission keys of the current school user, loaded once per request. */
  permissionKeys?: Set<string>;
}
