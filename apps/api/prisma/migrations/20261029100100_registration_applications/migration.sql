ALTER TABLE "school_registrations"
  ADD COLUMN IF NOT EXISTS "owner_nic_enc" TEXT,
  ADD COLUMN IF NOT EXISTS "verification" JSONB,
  ADD COLUMN IF NOT EXISTS "decided_by" TEXT,
  ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "decision_note" TEXT,
  DROP COLUMN IF EXISTS "registry_entry_id";

-- Schools are verified by the owner's team, not matched against an automatic register.
DROP TABLE IF EXISTS "school_registry";

-- One waiting application per NTN, per owner and per email (the same rule as for approved ones).
CREATE UNIQUE INDEX IF NOT EXISTS "school_registrations_one_pending_ntn" ON "school_registrations"("ntn") WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS "school_registrations_one_pending_owner" ON "school_registrations"("owner_nic_hash") WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS "school_registrations_one_pending_email" ON "school_registrations"(lower("email")) WHERE status = 'pending';
