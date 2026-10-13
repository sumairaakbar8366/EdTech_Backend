-- User IDs (TCH-2026-0007): every school login signs in with a structured, immutable ID.
-- Personal emails become optional, non-unique and OTP-verified.

-- --- Users: personal email + login id ------------------------------------------------------
DROP INDEX "users_school_id_email_key";
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "login_id" TEXT,
  ALTER COLUMN "email" DROP NOT NULL;
CREATE INDEX "users_school_id_email_idx" ON "users"("school_id", "email");

-- --- Registry of issued IDs --------------------------------------------------------------------
CREATE TABLE "login_ids" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "login_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "user_id" UUID,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_ids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "login_ids_format" CHECK ("login_id" ~ '^[A-Z]{3}-[0-9]{4}-[0-9]{4,}$' AND "login_id" = "prefix" || '-' || "year" || '-' || lpad("seq"::text, 4, '0')),
    CONSTRAINT "login_ids_prefix" CHECK ("prefix" IN ('ADM', 'ACC', 'TCH', 'STF', 'PAR', 'STU', 'SUP'))
);
CREATE UNIQUE INDEX "login_ids_user_id_key" ON "login_ids"("user_id");
CREATE UNIQUE INDEX "login_ids_school_id_login_id_key" ON "login_ids"("school_id", "login_id");
CREATE UNIQUE INDEX "login_ids_school_id_prefix_year_seq_key" ON "login_ids"("school_id", "prefix", "year", "seq");
ALTER TABLE "login_ids" ADD CONSTRAINT "login_ids_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "login_ids" ADD CONSTRAINT "login_ids_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "login_ids" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_ids" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "login_ids" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

-- --- Backfill: one ID per existing login, school by school (RLS stays on) -----------------------
-- Prefix from the strongest role; year from the joining date (staff), admission date (students)
-- or the account's creation; numbered in creation order.
DO $$
DECLARE s uuid;
BEGIN
  FOR s IN SELECT id FROM schools LOOP
    PERFORM set_config('app.current_school_id', s::text, true);
    INSERT INTO login_ids (id, school_id, login_id, prefix, year, seq, user_id, issued_at)
    SELECT gen_random_uuid(), s, k.prefix || '-' || k.year || '-' || lpad(k.seq::text, 4, '0'), k.prefix, k.year, k.seq, k.id, now()
    FROM (
      SELECT p.*, row_number() OVER (PARTITION BY p.prefix, p.year ORDER BY p.created_at, p.id)::int AS seq
      FROM (
        SELECT u.id, u.created_at,
          CASE
            WHEN bool_or(r.key = 'school_admin') THEN 'ADM'
            WHEN bool_or(r.key = 'accounts') THEN 'ACC'
            WHEN bool_or(r.key = 'teacher') THEN 'TCH'
            WHEN bool_or(r.key = 'non_teaching_staff') THEN 'STF'
            WHEN bool_or(r.key = 'parent') THEN 'PAR'
            WHEN bool_or(r.key = 'student') THEN 'STU'
            WHEN e.id IS NOT NULL THEN 'STF'
            WHEN st.id IS NOT NULL THEN 'STU'
            ELSE 'PAR'
          END AS prefix,
          extract(year FROM COALESCE(e.join_date, st.admission_date, u.created_at))::int AS year
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        LEFT JOIN employees e ON e.user_id = u.id
        LEFT JOIN students st ON st.user_id = u.id
        GROUP BY u.id, u.created_at, e.id, e.join_date, st.id, st.admission_date
      ) p
    ) k;
    UPDATE users u SET login_id = l.login_id FROM login_ids l WHERE l.user_id = u.id;
  END LOOP;
END
$$;

ALTER TABLE "users" ALTER COLUMN "login_id" SET NOT NULL;
CREATE UNIQUE INDEX "users_school_id_login_id_key" ON "users"("school_id", "login_id");

-- --- Immutability ------------------------------------------------------------------------------
-- A User ID can never be changed. A registry row can never be edited or deleted (only its user_id
-- may be cleared when the login is deleted, and rows go with their school).
CREATE OR REPLACE FUNCTION users_login_id_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.login_id IS DISTINCT FROM OLD.login_id THEN
    RAISE EXCEPTION 'A User ID cannot be changed (% -> %)', OLD.login_id, NEW.login_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_login_id_immutable BEFORE UPDATE OF login_id ON users FOR EACH ROW EXECUTE FUNCTION users_login_id_immutable();

CREATE OR REPLACE FUNCTION login_ids_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM schools WHERE id = OLD.school_id) THEN
      RAISE EXCEPTION 'Issued User IDs cannot be deleted (%)', OLD.login_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.school_id, NEW.login_id, NEW.prefix, NEW.year, NEW.seq, NEW.issued_at) IS DISTINCT FROM (OLD.school_id, OLD.login_id, OLD.prefix, OLD.year, OLD.seq, OLD.issued_at)
     OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Issued User IDs cannot be changed (%)', OLD.login_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER login_ids_append_only BEFORE UPDATE OR DELETE ON login_ids FOR EACH ROW EXECUTE FUNCTION login_ids_append_only();

-- --- Separate staff tables for reporting (employees stays the one source of truth) ------------
CREATE VIEW teaching_staff WITH (security_invoker = true) AS SELECT * FROM employees WHERE staff_type = 'teaching';
CREATE VIEW non_teaching_staff WITH (security_invoker = true) AS SELECT * FROM employees WHERE staff_type = 'non_teaching';
GRANT SELECT ON teaching_staff, non_teaching_staff TO schoolerp_app;
