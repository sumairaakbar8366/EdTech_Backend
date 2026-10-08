-- CreateEnum
CREATE TYPE "job_post_status" AS ENUM ('draft', 'open', 'closed');

-- CreateEnum
CREATE TYPE "application_status" AS ENUM ('applied', 'shortlisted', 'interview', 'selected', 'hired', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "interview_mode" AS ENUM ('in_person', 'online', 'phone');

-- CreateEnum
CREATE TYPE "interview_recommendation" AS ENUM ('strong_yes', 'yes', 'no', 'strong_no');

-- CreateTable
CREATE TABLE "job_posts" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "staff_type" "staff_type" NOT NULL,
    "department" TEXT,
    "description" TEXT,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "status" "job_post_status" NOT NULL DEFAULT 'draft',
    "closing_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "job_post_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "education" TEXT,
    "experience_years" INTEGER,
    "experience" TEXT,
    "previous_schools" TEXT,
    "references" TEXT,
    "cover_note" TEXT,
    "status" "application_status" NOT NULL DEFAULT 'applied',
    "employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_records" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "mode" "interview_mode" NOT NULL DEFAULT 'in_person',
    "interviewer" TEXT NOT NULL,
    "score" INTEGER,
    "recommendation" "interview_recommendation",
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_posts_school_id_status_idx" ON "job_posts"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_posts_id_school_id_key" ON "job_posts"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_employee_id_key" ON "job_applications"("employee_id");

-- CreateIndex
CREATE INDEX "job_applications_school_id_status_idx" ON "job_applications"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_job_post_id_email_key" ON "job_applications"("job_post_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_employee_id_school_id_key" ON "job_applications"("employee_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_id_school_id_key" ON "job_applications"("id", "school_id");

-- CreateIndex
CREATE INDEX "interview_records_application_id_scheduled_at_idx" ON "interview_records"("application_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "interview_records_school_id_idx" ON "interview_records"("school_id");

-- AddForeignKey
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_campus_id_school_id_fkey" FOREIGN KEY ("campus_id", "school_id") REFERENCES "campuses"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_post_id_school_id_fkey" FOREIGN KEY ("job_post_id", "school_id") REFERENCES "job_posts"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_records" ADD CONSTRAINT "interview_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_records" ADD CONSTRAINT "interview_records_application_id_school_id_fkey" FOREIGN KEY ("application_id", "school_id") REFERENCES "job_applications"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_posts','job_applications','interview_records']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;

-- --- Value rules ----------------------------------------------------------------
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_openings_positive" CHECK (openings >= 1);
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_email_lowercase" CHECK (email = lower(email));
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_experience_years" CHECK (experience_years IS NULL OR experience_years BETWEEN 0 AND 60);
-- A hired application must point at the employee it created, and only hired ones may.
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_hired_has_employee"
  CHECK ((status = 'hired') = (employee_id IS NOT NULL));
ALTER TABLE "interview_records" ADD CONSTRAINT "interview_records_score_range" CHECK (score IS NULL OR score BETWEEN 1 AND 10);
