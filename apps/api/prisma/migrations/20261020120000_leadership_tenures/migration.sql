-- Service record of School Admins and Principals: one row per period in the role.
CREATE TABLE "leadership_tenures" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_id" UUID,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "login_id" TEXT NOT NULL,
    "email" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "end_action" TEXT,
    "end_reason" TEXT,
    "replaced_by_name" TEXT,
    "ended_by_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leadership_tenures_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leadership_tenures_school_id_user_id_idx" ON "leadership_tenures"("school_id", "user_id");
ALTER TABLE "leadership_tenures" ADD CONSTRAINT "leadership_tenures_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leadership_tenures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leadership_tenures" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leadership_tenures" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
