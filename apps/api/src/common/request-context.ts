import type { Request } from 'express';

export type TenantContext =
  | { kind: 'platform' }
  | { kind: 'school'; schoolId: string; slug: string; name: string };

export type AuthContext =
  | { scope: 'platform'; adminId: string }
  /** `support`: the platform owner working inside the school ("Open as admin"), shown and audited as such. */
  | { scope: 'school'; userId: string; schoolId: string; support?: { adminId: string; name: string } };

export interface AppRequest extends Request {
  tenant?: TenantContext;
  auth?: AuthContext;
  /** Permission keys of the current school user, loaded once per request. */
  permissionKeys?: Set<string>;
}
