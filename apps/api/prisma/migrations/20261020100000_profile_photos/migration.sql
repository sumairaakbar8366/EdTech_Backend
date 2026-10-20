-- Profile pictures: on people records, logins and applications.
ALTER TABLE "users" ADD COLUMN "photo_key" UUID;
ALTER TABLE "employees" ADD COLUMN "photo_key" UUID;
ALTER TABLE "job_applications" ADD COLUMN "photo_key" UUID;
ALTER TABLE "students" ADD COLUMN "photo_key" UUID;
ALTER TABLE "guardians" ADD COLUMN "photo_key" UUID;
ALTER TABLE "admission_applications" ADD COLUMN "photo_key" UUID;

-- Students and staff ask the admin to change their picture.
CREATE TYPE "photo_request_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "photo_change_requests" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "photo_key" UUID NOT NULL,
    "status" "photo_request_status" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "photo_change_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "photo_change_requests_school_id_status_created_at_idx" ON "photo_change_requests"("school_id", "status", "created_at" DESC);
ALTER TABLE "photo_change_requests" ADD CONSTRAINT "photo_change_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "photo_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "photo_change_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "photo_change_requests" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
