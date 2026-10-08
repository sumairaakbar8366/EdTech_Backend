-- Admin-issued passwords must be replaced by the user at first sign-in (Users & Access, 2026-10-06).
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
