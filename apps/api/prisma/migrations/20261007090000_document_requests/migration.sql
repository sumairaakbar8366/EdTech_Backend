-- CreateEnum
CREATE TYPE "document_request_type" AS ENUM ('marksheet', 'report_card', 'character_certificate', 'leaving_certificate', 'bonafide_certificate', 'transcript', 'fee_clearance', 'other');

-- CreateEnum
CREATE TYPE "document_request_status" AS ENUM ('submitted', 'in_review', 'ready', 'completed', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "document_delivery" AS ENUM ('pickup', 'digital');

-- CreateTable
CREATE TABLE "document_requests" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "request_no" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "type" "document_request_type" NOT NULL,
    "purpose" TEXT NOT NULL,
    "details" TEXT,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "delivery" "document_delivery" NOT NULL DEFAULT 'pickup',
    "status" "document_request_status" NOT NULL DEFAULT 'submitted',
    "admin_note" TEXT,
    "document_id" UUID,
    "processed_by" UUID,
    "ready_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_request_events" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "status" "document_request_status" NOT NULL,
    "note" TEXT,
    "actor_id" UUID,
    "actor_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_requests_school_id_status_idx" ON "document_requests"("school_id", "status");

-- CreateIndex
CREATE INDEX "document_requests_school_id_requested_by_idx" ON "document_requests"("school_id", "requested_by");

-- CreateIndex
CREATE UNIQUE INDEX "document_requests_school_id_request_no_key" ON "document_requests"("school_id", "request_no");

-- CreateIndex
CREATE UNIQUE INDEX "document_requests_id_school_id_key" ON "document_requests"("id", "school_id");

-- CreateIndex
CREATE INDEX "document_request_events_request_id_idx" ON "document_request_events"("request_id");

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_events" ADD CONSTRAINT "document_request_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_events" ADD CONSTRAINT "document_request_events_request_id_school_id_fkey" FOREIGN KEY ("request_id", "school_id") REFERENCES "document_requests"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_requests','document_request_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;
