-- CreateEnum
CREATE TYPE "registration_status" AS ENUM ('rejected', 'approved');

-- CreateEnum
CREATE TYPE "access_request_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "complaint_severity" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "complaint_status" AS ENUM ('open', 'in_review', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "scholarship_program_status" AS ENUM ('draft', 'recruiting', 'live', 'closed');

-- CreateEnum
CREATE TYPE "scholarship_offer_status" AS ENUM ('sent', 'viewed', 'submitted', 'declined', 'withdrawn');

-- CreateEnum
CREATE TYPE "scholarship_request_status" AS ENUM ('submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "scholarship_grant_status" AS ENUM ('pledged', 'disbursed', 'cancelled');

-- CreateTable
CREATE TABLE "platform_forms" (
    "kind" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "settings" JSONB,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_forms_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "school_registry" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "registration_no" TEXT,
    "ntn" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Pakistan',
    "address" TEXT,
    "owner_name" TEXT,
    "owner_nic_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "school_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_registrations" (
    "id" UUID NOT NULL,
    "status" "registration_status" NOT NULL,
    "school_name" TEXT NOT NULL,
    "ntn" TEXT NOT NULL,
    "registration_no" TEXT,
    "owner_first_name" TEXT NOT NULL,
    "owner_last_name" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "owner_nic_hash" TEXT NOT NULL,
    "owner_nic_last4" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email_method" TEXT NOT NULL,
    "phone_method" TEXT,
    "country" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "school_type" TEXT,
    "student_count" INTEGER NOT NULL,
    "teacher_count" INTEGER NOT NULL,
    "staff_count" INTEGER NOT NULL DEFAULT 0,
    "answers" JSONB,
    "checks" JSONB NOT NULL,
    "failure_reasons" TEXT[],
    "registry_entry_id" UUID,
    "trial_days" INTEGER,
    "school_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_requests" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_method" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "requested_role" TEXT NOT NULL,
    "note" TEXT,
    "answers" JSONB,
    "status" "access_request_status" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_forms" (
    "school_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "school_forms_pkey" PRIMARY KEY ("school_id","kind")
);

-- CreateTable
CREATE TABLE "person_custom_data" (
    "school_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "person_custom_data_pkey" PRIMARY KEY ("school_id","subject_type","subject_id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "ticket_no" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "complaint_severity" NOT NULL DEFAULT 'normal',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "complainant_user_id" UUID NOT NULL,
    "complainant_role" TEXT NOT NULL,
    "against_kind" TEXT NOT NULL,
    "against_user_id" UUID,
    "against_name" TEXT,
    "handler_scope" TEXT NOT NULL,
    "status" "complaint_status" NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "resolution_note" TEXT,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_messages" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "complaint_id" UUID NOT NULL,
    "author_user_id" UUID,
    "side" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'message',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_events" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "description" TEXT,
    "share_with_sponsors" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'company',
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scholarship_programs" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "sponsor_id" UUID,
    "description" TEXT,
    "criteria" TEXT,
    "award_amount" DECIMAL(12,2),
    "budget" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "slots" INTEGER NOT NULL DEFAULT 0,
    "deadline" DATE,
    "status" "scholarship_program_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scholarship_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scholarship_offers" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "token_hash" TEXT NOT NULL,
    "message" TEXT,
    "status" "scholarship_offer_status" NOT NULL DEFAULT 'sent',
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewed_at" TIMESTAMPTZ(3),
    "responded_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_by" TEXT,

    CONSTRAINT "scholarship_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scholarship_requests" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "students_requested" INTEGER NOT NULL DEFAULT 0,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "status" "scholarship_request_status" NOT NULL DEFAULT 'submitted',
    "review_note" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scholarship_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scholarship_grants" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "request_id" UUID,
    "student_name" TEXT NOT NULL,
    "class_name" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "scholarship_grant_status" NOT NULL DEFAULT 'pledged',
    "awarded_on" DATE NOT NULL,
    "disbursed_on" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scholarship_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_opportunities" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "starts_on" DATE,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_posts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "event_name" TEXT,
    "event_date" DATE,
    "location" TEXT,
    "school_name" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_post_images" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "site_post_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_progress" (
    "subject" TEXT NOT NULL,
    "tour_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tour_progress_pkey" PRIMARY KEY ("subject","tour_key")
);

-- CreateIndex
CREATE INDEX "school_registry_ntn_idx" ON "school_registry"("ntn");

-- CreateIndex
CREATE INDEX "school_registry_registration_no_idx" ON "school_registry"("registration_no");

-- CreateIndex
CREATE INDEX "school_registry_city_province_idx" ON "school_registry"("city", "province");

-- CreateIndex
CREATE UNIQUE INDEX "school_registrations_school_id_key" ON "school_registrations"("school_id");

-- CreateIndex
CREATE INDEX "school_registrations_status_created_at_idx" ON "school_registrations"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "school_registrations_ntn_idx" ON "school_registrations"("ntn");

-- CreateIndex
CREATE INDEX "school_registrations_owner_nic_hash_idx" ON "school_registrations"("owner_nic_hash");

-- CreateIndex
CREATE INDEX "school_registrations_email_idx" ON "school_registrations"("email");

-- CreateIndex
CREATE INDEX "access_requests_school_id_status_created_at_idx" ON "access_requests"("school_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "access_requests_school_id_email_idx" ON "access_requests"("school_id", "email");

-- CreateIndex
CREATE INDEX "complaints_school_id_status_last_activity_at_idx" ON "complaints"("school_id", "status", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "complaints_school_id_complainant_user_id_idx" ON "complaints"("school_id", "complainant_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_school_id_ticket_no_key" ON "complaints"("school_id", "ticket_no");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_id_school_id_key" ON "complaints"("id", "school_id");

-- CreateIndex
CREATE INDEX "complaint_messages_complaint_id_created_at_idx" ON "complaint_messages"("complaint_id", "created_at");

-- CreateIndex
CREATE INDEX "school_events_school_id_starts_on_idx" ON "school_events"("school_id", "starts_on" DESC);

-- CreateIndex
CREATE INDEX "scholarship_programs_status_idx" ON "scholarship_programs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "scholarship_offers_token_hash_key" ON "scholarship_offers"("token_hash");

-- CreateIndex
CREATE INDEX "scholarship_offers_school_id_status_idx" ON "scholarship_offers"("school_id", "status");

-- CreateIndex
CREATE INDEX "scholarship_offers_program_id_status_idx" ON "scholarship_offers"("program_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scholarship_requests_offer_id_key" ON "scholarship_requests"("offer_id");

-- CreateIndex
CREATE INDEX "scholarship_requests_program_id_status_idx" ON "scholarship_requests"("program_id", "status");

-- CreateIndex
CREATE INDEX "scholarship_requests_school_id_idx" ON "scholarship_requests"("school_id");

-- CreateIndex
CREATE INDEX "scholarship_grants_program_id_status_idx" ON "scholarship_grants"("program_id", "status");

-- CreateIndex
CREATE INDEX "scholarship_grants_school_id_idx" ON "scholarship_grants"("school_id");

-- CreateIndex
CREATE INDEX "school_opportunities_status_created_at_idx" ON "school_opportunities"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "school_opportunities_source_type_source_id_key" ON "school_opportunities"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "site_posts_published_published_at_idx" ON "site_posts"("published", "published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "site_post_images_storage_key_key" ON "site_post_images"("storage_key");

-- CreateIndex
CREATE INDEX "site_post_images_post_id_sort_order_idx" ON "site_post_images"("post_id", "sort_order");

-- AddForeignKey
ALTER TABLE "school_registrations" ADD CONSTRAINT "school_registrations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_forms" ADD CONSTRAINT "school_forms_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_custom_data" ADD CONSTRAINT "person_custom_data_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_complaint_id_school_id_fkey" FOREIGN KEY ("complaint_id", "school_id") REFERENCES "complaints"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_events" ADD CONSTRAINT "school_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_programs" ADD CONSTRAINT "scholarship_programs_sponsor_id_fkey" FOREIGN KEY ("sponsor_id") REFERENCES "sponsors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_offers" ADD CONSTRAINT "scholarship_offers_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "scholarship_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_offers" ADD CONSTRAINT "scholarship_offers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_offers" ADD CONSTRAINT "scholarship_offers_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "school_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_requests" ADD CONSTRAINT "scholarship_requests_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "scholarship_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_requests" ADD CONSTRAINT "scholarship_requests_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "scholarship_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_requests" ADD CONSTRAINT "scholarship_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_grants" ADD CONSTRAINT "scholarship_grants_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "scholarship_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_grants" ADD CONSTRAINT "scholarship_grants_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_grants" ADD CONSTRAINT "scholarship_grants_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "scholarship_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_opportunities" ADD CONSTRAINT "school_opportunities_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_post_images" ADD CONSTRAINT "site_post_images_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "site_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One open request per email and role.
CREATE UNIQUE INDEX "access_requests_one_pending" ON "access_requests"("school_id","email","requested_role") WHERE status = 'pending';

-- Row-level security: a school only ever sees its own rows.
ALTER TABLE "access_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "access_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "access_requests" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
ALTER TABLE "school_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_forms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "school_forms" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
ALTER TABLE "person_custom_data" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_custom_data" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "person_custom_data" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
ALTER TABLE "complaints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "complaints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "complaints" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
ALTER TABLE "complaint_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "complaint_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "complaint_messages" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
ALTER TABLE "school_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "school_events" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());

-- No duplicates, enforced by the database itself (not only by the application): one approved registration
-- per NTN, per owner (CNIC hash), per email and per school name in a city; one register entry per NTN / number.
CREATE UNIQUE INDEX "school_registrations_one_approved_ntn" ON "school_registrations"("ntn") WHERE status = 'approved';
CREATE UNIQUE INDEX "school_registrations_one_approved_owner" ON "school_registrations"("owner_nic_hash") WHERE status = 'approved';
CREATE UNIQUE INDEX "school_registrations_one_approved_email" ON "school_registrations"(lower("email")) WHERE status = 'approved';
CREATE UNIQUE INDEX "school_registrations_one_approved_name_city" ON "school_registrations"(lower("school_name"), lower("city")) WHERE status = 'approved';
CREATE UNIQUE INDEX "school_registry_unique_ntn" ON "school_registry"("ntn") WHERE "ntn" IS NOT NULL;
CREATE UNIQUE INDEX "school_registry_unique_registration_no" ON "school_registry"(lower("registration_no")) WHERE "registration_no" IS NOT NULL;
-- One pending offer per school and program; one request per offer is already unique.
CREATE UNIQUE INDEX "scholarship_offers_one_open" ON "scholarship_offers"("school_id", "program_id") WHERE status IN ('sent', 'viewed');
