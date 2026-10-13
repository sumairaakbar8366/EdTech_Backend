-- AlterEnum
ALTER TYPE "document_owner_type" ADD VALUE 'job_application';






-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "address" TEXT,
ADD COLUMN     "available_from" DATE,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "cnic" TEXT,
ADD COLUMN     "current_designation" TEXT,
ADD COLUMN     "current_employer" TEXT,
ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "expected_salary" DECIMAL(12,2),
ADD COLUMN     "father_name" TEXT,
ADD COLUMN     "gender" "gender",
ADD COLUMN     "graduation_year" INTEGER,
ADD COLUMN     "highest_qualification" TEXT,
ADD COLUMN     "institution" TEXT,
ADD COLUMN     "languages" TEXT,
ADD COLUMN     "linkedin_url" TEXT,
ADD COLUMN     "major_subjects" TEXT,
ADD COLUMN     "notice_period" TEXT,
ADD COLUMN     "skills" TEXT,
ADD COLUMN     "subjects" TEXT;

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" "application_status",
    "to_status" "application_status" NOT NULL,
    "note" TEXT,
    "changed_by" UUID,
    "changed_by_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_status_history_application_id_created_at_idx" ON "application_status_history"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "application_status_history_school_id_created_at_idx" ON "application_status_history"("school_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_school_id_fkey" FOREIGN KEY ("application_id", "school_id") REFERENCES "job_applications"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS like every tenant table.
ALTER TABLE "application_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_status_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "application_status_history" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

-- Backfill: every existing application starts its log with "applied", plus its current stage.
DO $$
DECLARE s uuid;
BEGIN
  FOR s IN SELECT id FROM schools LOOP
    PERFORM set_config('app.current_school_id', s::text, true);
    INSERT INTO application_status_history (id, school_id, application_id, from_status, to_status, note, created_at)
    SELECT gen_random_uuid(), a.school_id, a.id, NULL, 'applied', CASE WHEN a.source = 'website' THEN 'Applied on the school website' ELSE 'Added by the office' END, a.created_at
    FROM job_applications a;
    INSERT INTO application_status_history (id, school_id, application_id, from_status, to_status, note, created_at)
    SELECT gen_random_uuid(), a.school_id, a.id, 'applied', a.status, 'Recorded before the status log existed', a.updated_at
    FROM job_applications a WHERE a.status <> 'applied';
  END LOOP;
END
$$;
