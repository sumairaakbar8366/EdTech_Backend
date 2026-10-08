-- CreateEnum
CREATE TYPE "admission_status" AS ENUM ('submitted', 'documents_verified', 'interview_scheduled', 'under_review', 'approved', 'rejected', 'enrolled', 'withdrawn');

-- CreateEnum
CREATE TYPE "admission_assessment_kind" AS ENUM ('interview', 'test');

-- CreateEnum
CREATE TYPE "admission_assessment_result" AS ENUM ('pending', 'pass', 'fail');

-- CreateTable
CREATE TABLE "admission_applications" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "application_no" TEXT NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "gender" "gender",
    "date_of_birth" DATE NOT NULL,
    "previous_school" TEXT,
    "guardian_first_name" TEXT NOT NULL,
    "guardian_last_name" TEXT NOT NULL,
    "guardian_relation" "guardian_relation" NOT NULL,
    "guardian_phone" TEXT NOT NULL,
    "guardian_email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "admission_status" NOT NULL DEFAULT 'submitted',
    "student_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_interviews" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "kind" "admission_assessment_kind" NOT NULL DEFAULT 'interview',
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "conducted_by" TEXT NOT NULL,
    "score" INTEGER,
    "result" "admission_assessment_result" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_status_history" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" "admission_status",
    "to_status" "admission_status" NOT NULL,
    "note" TEXT,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_student_id_key" ON "admission_applications"("student_id");

-- CreateIndex
CREATE INDEX "admission_applications_school_id_status_idx" ON "admission_applications"("school_id", "status");

-- CreateIndex
CREATE INDEX "admission_applications_academic_year_id_class_id_idx" ON "admission_applications"("academic_year_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_school_id_application_no_key" ON "admission_applications"("school_id", "application_no");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_student_id_school_id_key" ON "admission_applications"("student_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_id_school_id_key" ON "admission_applications"("id", "school_id");

-- CreateIndex
CREATE INDEX "admission_interviews_application_id_scheduled_at_idx" ON "admission_interviews"("application_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "admission_interviews_school_id_idx" ON "admission_interviews"("school_id");

-- CreateIndex
CREATE INDEX "admission_status_history_application_id_changed_at_idx" ON "admission_status_history"("application_id", "changed_at");

-- CreateIndex
CREATE INDEX "admission_status_history_school_id_idx" ON "admission_status_history"("school_id");

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_academic_year_id_school_id_fkey" FOREIGN KEY ("academic_year_id", "school_id") REFERENCES "academic_years"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_class_id_school_id_fkey" FOREIGN KEY ("class_id", "school_id") REFERENCES "classes"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_campus_id_school_id_fkey" FOREIGN KEY ("campus_id", "school_id") REFERENCES "campuses"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_interviews" ADD CONSTRAINT "admission_interviews_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_interviews" ADD CONSTRAINT "admission_interviews_application_id_school_id_fkey" FOREIGN KEY ("application_id", "school_id") REFERENCES "admission_applications"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_status_history" ADD CONSTRAINT "admission_status_history_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_status_history" ADD CONSTRAINT "admission_status_history_application_id_school_id_fkey" FOREIGN KEY ("application_id", "school_id") REFERENCES "admission_applications"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admission_applications','admission_interviews','admission_status_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;

-- --- Value rules ----------------------------------------------------------------
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_guardian_email_lowercase"
  CHECK (guardian_email IS NULL OR guardian_email = lower(guardian_email));
-- An enrolled application points at the student it created, and only enrolled ones may.
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_enrolled_has_student"
  CHECK ((status = 'enrolled') = (student_id IS NOT NULL));
ALTER TABLE "admission_interviews" ADD CONSTRAINT "admission_interviews_score_range" CHECK (score IS NULL OR score BETWEEN 0 AND 100);
