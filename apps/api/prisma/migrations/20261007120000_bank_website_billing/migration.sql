-- CreateEnum
CREATE TYPE "bank_account_status" AS ENUM ('pending', 'approved', 'rejected', 'replaced');

-- CreateEnum
CREATE TYPE "subscription_payment_status" AS ENUM ('pending', 'confirmed', 'rejected');

-- AlterTable
ALTER TABLE "job_applications" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'office';

-- AlterTable
ALTER TABLE "admission_applications" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'office';

-- AlterTable
ALTER TABLE "payroll_payments" ADD COLUMN     "bank_account_id" UUID,
ADD COLUMN     "payee_account" TEXT;

-- CreateTable
CREATE TABLE "employee_bank_accounts" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_title" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "iban" TEXT,
    "branch" TEXT,
    "status" "bank_account_status" NOT NULL DEFAULT 'pending',
    "request_note" TEXT,
    "review_note" TEXT,
    "submitted_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_websites" (
    "school_id" UUID NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "tagline" TEXT,
    "about" TEXT,
    "principal_name" TEXT,
    "principal_message" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "map_url" TEXT,
    "facebook_url" TEXT,
    "admissions_open" BOOLEAN NOT NULL DEFAULT true,
    "careers_open" BOOLEAN NOT NULL DEFAULT true,
    "hero_media_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "school_websites_pkey" PRIMARY KEY ("school_id")
);

-- CreateTable
CREATE TABLE "website_media" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "caption" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_billing_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "bank_name" TEXT,
    "account_title" TEXT,
    "account_number" TEXT,
    "iban" TEXT,
    "instructions" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "tier_id" UUID NOT NULL,
    "billing_cycle" "billing_cycle" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "payer_name" TEXT NOT NULL,
    "payer_bank" TEXT NOT NULL,
    "payer_account" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "paid_on" DATE NOT NULL,
    "note" TEXT,
    "status" "subscription_payment_status" NOT NULL DEFAULT 'pending',
    "submitted_by" UUID NOT NULL,
    "submitted_by_name" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_bank_accounts_school_id_status_idx" ON "employee_bank_accounts"("school_id", "status");

-- CreateIndex
CREATE INDEX "employee_bank_accounts_employee_id_idx" ON "employee_bank_accounts"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_media_storage_key_key" ON "website_media"("storage_key");

-- CreateIndex
CREATE INDEX "website_media_school_id_category_idx" ON "website_media"("school_id", "category");

-- CreateIndex
CREATE INDEX "subscription_payments_status_idx" ON "subscription_payments"("status");

-- CreateIndex
CREATE INDEX "subscription_payments_school_id_idx" ON "subscription_payments"("school_id");

-- AddForeignKey
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_websites" ADD CONSTRAINT "school_websites_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_media" ADD CONSTRAINT "website_media_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "subscription_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one approved and one pending bank account per staff member.
CREATE UNIQUE INDEX "employee_bank_accounts_one_approved" ON "employee_bank_accounts" ("employee_id") WHERE "status" = 'approved';
CREATE UNIQUE INDEX "employee_bank_accounts_one_pending" ON "employee_bank_accounts" ("employee_id") WHERE "status" = 'pending';

-- The platform's own bank details (filled in from the console).
INSERT INTO "platform_billing_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employee_bank_accounts','school_websites','website_media']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;
