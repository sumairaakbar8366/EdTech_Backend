import type { Request } from 'express';

export type TenantContext =
  | { kind: 'platform' }
  | { kind: 'school'; schoolId: string; slug: string; name: string };

export type AuthContext =
  | { scope: 'platform'; adminId: string }
  | { scope: 'school'; userId: string; schoolId: string };

export interface AppRequest extends Request {
  tenant?: TenantContext;
  auth?: AuthContext;
  /** Permission keys of the current school user, loaded once per request. */
  permissionKeys?: Set<string>;
}
