-- Principal logins get PRN-<year>-<n> User IDs.
ALTER TABLE "login_ids" DROP CONSTRAINT "login_ids_prefix";
ALTER TABLE "login_ids" ADD CONSTRAINT "login_ids_prefix" CHECK ("prefix" IN ('PRN', 'ADM', 'ACC', 'TCH', 'STF', 'PAR', 'STU', 'SUP'));

-- Shared owner accounts ("Owner 2"…): the existing owners are the main owners.
ALTER TABLE "platform_admins" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "label" TEXT,
ADD COLUMN "created_by_id" UUID;
UPDATE "platform_admins" SET "is_primary" = true;

-- Activity monitor: entries the main admin / owner edited.
ALTER TABLE "audit_logs" ADD COLUMN "title" TEXT, ADD COLUMN "note" TEXT;
ALTER TABLE "login_events" ADD COLUMN "title" TEXT, ADD COLUMN "note" TEXT;

-- Owner console changes.
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "ip" TEXT,
    "title" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at" DESC);
