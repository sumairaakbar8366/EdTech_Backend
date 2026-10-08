ALTER TYPE "school_application_status" ADD VALUE 'onboarded';

ALTER TABLE "school_applications" ADD COLUMN "school_id" UUID;

CREATE UNIQUE INDEX "school_applications_school_id_key" ON "school_applications"("school_id");

ALTER TABLE "school_applications"
ADD CONSTRAINT "school_applications_school_id_fkey"
FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;