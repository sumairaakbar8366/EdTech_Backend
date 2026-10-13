-- 2026-10-12: people sign in with their own email; one table per kind of person; login history.

-- The Step 2 reporting views are replaced by real tables of the same purpose.
DROP VIEW IF EXISTS teaching_staff;
DROP VIEW IF EXISTS non_teaching_staff;






-- CreateTable
CREATE TABLE "teachers" (
    "employee_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_no" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT NOT NULL,
    "department" TEXT,
    "status" TEXT NOT NULL,
    "join_date" DATE NOT NULL,
    "user_id" UUID,
    "login_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "non_teaching_staff" (
    "employee_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_no" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT NOT NULL,
    "department" TEXT,
    "status" TEXT NOT NULL,
    "join_date" DATE NOT NULL,
    "user_id" UUID,
    "login_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_teaching_staff_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" UUID NOT NULL,
    "school_id" UUID,
    "user_id" UUID,
    "platform_admin_id" UUID,
    "identifier" TEXT NOT NULL,
    "login_id" TEXT,
    "name" TEXT,
    "roles" TEXT,
    "method" TEXT NOT NULL DEFAULT 'password',
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teachers_school_id_status_idx" ON "teachers"("school_id", "status");

-- CreateIndex
CREATE INDEX "non_teaching_staff_school_id_status_idx" ON "non_teaching_staff"("school_id", "status");

-- CreateIndex
CREATE INDEX "login_events_created_at_idx" ON "login_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "login_events_school_id_created_at_idx" ON "login_events"("school_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "login_events_user_id_created_at_idx" ON "login_events"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_teaching_staff" ADD CONSTRAINT "non_teaching_staff_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- --- Email is the sign-in name: unique per school where set ------------------------------------
CREATE UNIQUE INDEX "users_school_id_email_unique" ON "users" ("school_id", "email") WHERE "email" IS NOT NULL;

-- --- Role tables: RLS like every tenant table --------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['teachers','non_teaching_staff']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;

-- Kept in step with employees: a teacher is in `teachers`, everyone else in `non_teaching_staff`.
CREATE OR REPLACE FUNCTION sync_staff_role_tables() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD; -- rows go with the employee (ON DELETE CASCADE)
  END IF;
  SELECT login_id INTO lid FROM users WHERE id = NEW.user_id;
  IF NEW.staff_type = 'teaching' THEN
    DELETE FROM non_teaching_staff WHERE employee_id = NEW.id;
    INSERT INTO teachers (employee_id, school_id, employee_no, first_name, last_name, email, phone, designation, department, status, join_date, user_id, login_id, updated_at)
    VALUES (NEW.id, NEW.school_id, NEW.employee_no, NEW.first_name, NEW.last_name, NEW.email, NEW.phone, NEW.designation, NEW.department, NEW.status::text, NEW.join_date, NEW.user_id, lid, now())
    ON CONFLICT (employee_id) DO UPDATE SET employee_no = EXCLUDED.employee_no, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
      designation = EXCLUDED.designation, department = EXCLUDED.department, status = EXCLUDED.status, join_date = EXCLUDED.join_date, user_id = EXCLUDED.user_id, login_id = EXCLUDED.login_id, updated_at = now();
  ELSE
    DELETE FROM teachers WHERE employee_id = NEW.id;
    INSERT INTO non_teaching_staff (employee_id, school_id, employee_no, first_name, last_name, email, phone, designation, department, status, join_date, user_id, login_id, updated_at)
    VALUES (NEW.id, NEW.school_id, NEW.employee_no, NEW.first_name, NEW.last_name, NEW.email, NEW.phone, NEW.designation, NEW.department, NEW.status::text, NEW.join_date, NEW.user_id, lid, now())
    ON CONFLICT (employee_id) DO UPDATE SET employee_no = EXCLUDED.employee_no, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
      designation = EXCLUDED.designation, department = EXCLUDED.department, status = EXCLUDED.status, join_date = EXCLUDED.join_date, user_id = EXCLUDED.user_id, login_id = EXCLUDED.login_id, updated_at = now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employees_sync_role_tables AFTER INSERT OR UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION sync_staff_role_tables();

-- Backfill, school by school (RLS stays on).
DO $$
DECLARE s uuid;
BEGIN
  FOR s IN SELECT id FROM schools LOOP
    PERFORM set_config('app.current_school_id', s::text, true);
    INSERT INTO teachers (employee_id, school_id, employee_no, first_name, last_name, email, phone, designation, department, status, join_date, user_id, login_id)
    SELECT e.id, e.school_id, e.employee_no, e.first_name, e.last_name, e.email, e.phone, e.designation, e.department, e.status::text, e.join_date, e.user_id, u.login_id
    FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.staff_type = 'teaching';
    INSERT INTO non_teaching_staff (employee_id, school_id, employee_no, first_name, last_name, email, phone, designation, department, status, join_date, user_id, login_id)
    SELECT e.id, e.school_id, e.employee_no, e.first_name, e.last_name, e.email, e.phone, e.designation, e.department, e.status::text, e.join_date, e.user_id, u.login_id
    FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.staff_type <> 'teaching';
  END LOOP;
END
$$;
