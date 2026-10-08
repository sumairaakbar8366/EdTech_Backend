// Tenant addressing rules. Source: architecture board, page 2 (Domain / Tenant Resolution).
// A school is reached at <slug>.<base domain>, or at a verified custom domain.

/** DNS label rules: 3–63 chars, lowercase letters, digits and inner hyphens. */
export const SCHOOL_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/** Subdomains that can never be a school. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin', 'api', 'app', 'www', 'mail', 'smtp', 'ftp', 'static', 'assets', 'cdn', 'docs',
  'help', 'support', 'status', 'billing', 'platform', 'auth', 'login', 'dashboard', 'dev',
  'staging', 'test', 'demo-admin', 'root', 'system',
]);

export function isValidSchoolSlug(slug: string): boolean {
  return SCHOOL_SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

export type HostResolution =
  | { kind: 'platform' }
  | { kind: 'subdomain'; slug: string }
  | { kind: 'custom'; hostname: string };

export interface HostConfig {
  /** e.g. "localhost" in development, "schoolerp.app" in production */
  baseDomain: string;
  /** Hostname of the platform admin console, e.g. "admin.localhost" */
  platformHost: string;
}

/** Lowercases, strips the port and any trailing dot. Returns null for empty or malformed input. */
export function normalizeHostname(host: string | undefined | null): string | null {
  if (!host) return null;
  let value = host.trim().toLowerCase();
  if (value.startsWith('[')) return null; // IPv6 literals are never tenant hosts
  const colon = value.indexOf(':');
  if (colon !== -1) value = value.slice(0, colon);
  if (value.endsWith('.')) value = value.slice(0, -1);
  if (!/^[a-z0-9.-]+$/.test(value) || value.length > 253) return null;
  return value;
}

/** Classifies a request host. Does not touch the database. */
export function resolveHost(host: string | undefined | null, config: HostConfig): HostResolution | null {
  const hostname = normalizeHostname(host);
  if (!hostname) return null;
  if (hostname === config.platformHost) return { kind: 'platform' };
  if (hostname === config.baseDomain) return null;

  const suffix = `.${config.baseDomain}`;
  if (hostname.endsWith(suffix)) {
    const label = hostname.slice(0, -suffix.length);
    // Only a single label directly under the base domain can be a school.
    if (label.includes('.') || !isValidSchoolSlug(label)) return null;
    return { kind: 'subdomain', slug: label };
  }
  return { kind: 'custom', hostname };
}
