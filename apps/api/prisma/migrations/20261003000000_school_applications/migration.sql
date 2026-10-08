CREATE TYPE "school_application_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "school_applications" (
    "id" UUID NOT NULL,
    "school_name" TEXT NOT NULL,
    "contact_first_name" TEXT NOT NULL,
    "contact_last_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "requested_tier_code" TEXT,
    "notes" TEXT,
    "status" "school_application_status" NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "school_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "school_applications_status_created_at_idx" ON "school_applications"("status", "created_at");