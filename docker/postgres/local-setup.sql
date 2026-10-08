-- One-time setup for a natively installed PostgreSQL (no Docker).
-- Run as the "postgres" superuser:
--   psql -U postgres -h localhost -f docker/postgres/local-setup.sql
-- Safe to run again: it only creates what is missing.
--
-- schoolerp      owns the database and runs migrations (not a superuser).
-- schoolerp_app  is what the API connects as. No SUPERUSER and no BYPASSRLS,
--                so row-level security always applies to it.
-- Passwords match apps/api/.env.example (local development only).

SELECT 'CREATE ROLE schoolerp WITH LOGIN PASSWORD ''schoolerp'' NOSUPERUSER NOBYPASSRLS NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolerp') \gexec

SELECT 'CREATE ROLE schoolerp_app WITH LOGIN PASSWORD ''schoolerp_app'' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolerp_app') \gexec

SELECT 'CREATE DATABASE schoolerp OWNER schoolerp ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'schoolerp') \gexec

GRANT CONNECT ON DATABASE schoolerp TO schoolerp_app;
