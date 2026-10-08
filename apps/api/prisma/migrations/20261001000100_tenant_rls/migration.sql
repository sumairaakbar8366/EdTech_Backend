-- Tenant isolation, app-role privileges and integrity rules Prisma cannot express.
--
-- The API connects as "schoolerp_app" (no SUPERUSER, no BYPASSRLS). For every request
-- on a school tenant it sets the transaction-local setting app.current_school_id;
-- tenant-owned tables only expose rows for that school. With no setting, they expose nothing.
--
-- CONVENTION: every future migration that adds a tenant-owned table must also
-- ENABLE + FORCE row level security on it and create a "tenant_isolation" policy.

-- --- Application role --------------------------------------------------------
-- Created by docker/postgres/init in development; in other environments it is
-- created here without login, and operations grant LOGIN + password separately.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolerp_app') THEN
    CREATE ROLE schoolerp_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO schoolerp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO schoolerp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO schoolerp_app;
-- Tables created by later migrations (run by the same owner) get the same privileges.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO schoolerp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO schoolerp_app;

-- The migration history is not the application's business.
REVOKE ALL ON TABLE "_prisma_migrations" FROM schoolerp_app;

-- --- Current tenant helper ---------------------------------------------------
-- NULLIF guards against the empty string a reset custom setting can leave behind.
CREATE OR REPLACE FUNCTION app_current_school_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_school_id', true), '')::uuid
$$;

-- --- Row-level security on tenant-owned tables -------------------------------
ALTER TABLE "school_settings"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_settings"  FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "school_settings"
  USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

ALTER TABLE "campuses"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campuses"         FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campuses"
  USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

ALTER TABLE "users"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users"            FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

ALTER TABLE "roles"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles"            FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roles"
  USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

ALTER TABLE "user_roles"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles"       FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_roles"
  USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_permissions"
  USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

-- --- Integrity rules ---------------------------------------------------------
-- Emails and hostnames are stored normalized, so unique indexes are case-insensitive in effect.
ALTER TABLE "users"           ADD CONSTRAINT "users_email_lowercase"           CHECK (email = lower(email));
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_email_lowercase" CHECK (email = lower(email));
ALTER TABLE "domains"         ADD CONSTRAINT "domains_hostname_lowercase"      CHECK (hostname = lower(hostname));
ALTER TABLE "schools"         ADD CONSTRAINT "schools_slug_format"
  CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$');

-- Limits and prices cannot be negative.
ALTER TABLE "subscription_tiers" ADD CONSTRAINT "subscription_tiers_limits_non_negative" CHECK (
  (max_campuses IS NULL OR max_campuses >= 0) AND
  (max_students IS NULL OR max_students >= 0) AND
  (max_staff    IS NULL OR max_staff    >= 0) AND
  (price_monthly IS NULL OR price_monthly >= 0) AND
  (price_annual  IS NULL OR price_annual  >= 0)
);

-- A trial must end after it starts.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_range" CHECK (
  trial_starts_at IS NULL OR trial_ends_at IS NULL OR trial_ends_at > trial_starts_at
);
