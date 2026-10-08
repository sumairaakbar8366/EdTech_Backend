-- Runs once, when the Postgres volume is first created.
-- The API connects as schoolerp_app: a plain login role with no SUPERUSER and
-- no BYPASSRLS, so row-level security policies are always enforced for it.
-- Table privileges are granted by the Prisma migrations.
CREATE ROLE schoolerp_app WITH LOGIN PASSWORD 'schoolerp_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE schoolerp TO schoolerp_app;
