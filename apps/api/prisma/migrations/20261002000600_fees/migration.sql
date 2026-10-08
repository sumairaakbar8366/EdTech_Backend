-- CreateEnum
CREATE TYPE "fee_frequency" AS ENUM ('one_time', 'monthly', 'termly', 'annual');

-- CreateEnum
CREATE TYPE "concession_kind" AS ENUM ('discount', 'scholarship', 'relief');

-- CreateEnum
CREATE TYPE "value_type" AS ENUM ('percentage', 'fixed');

-- CreateEnum
CREATE TYPE "award_status" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('pending', 'partial', 'paid', 'overdue', 'waived', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'bank_transfer', 'card', 'cheque', 'online');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('completed', 'voided');

-- CreateTable
CREATE TABLE "fee_categories" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structure_items" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" "fee_frequency" NOT NULL,

    CONSTRAINT "fee_structure_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_fee_assignments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_fee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "kind" "concession_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "value_type" "value_type" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "category_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scholarship_awards" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "discount_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "status" "award_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scholarship_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "period_label" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "invoice_status" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "received_by" UUID,
    "notes" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'completed',
    "void_reason" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_categories_school_id_code_key" ON "fee_categories"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "fee_categories_id_school_id_key" ON "fee_categories"("id", "school_id");

-- CreateIndex
CREATE INDEX "fee_structures_school_id_idx" ON "fee_structures"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_academic_year_id_class_id_name_key" ON "fee_structures"("academic_year_id", "class_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_id_school_id_key" ON "fee_structures"("id", "school_id");

-- CreateIndex
CREATE INDEX "fee_structure_items_school_id_idx" ON "fee_structure_items"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structure_items_structure_id_category_id_frequency_key" ON "fee_structure_items"("structure_id", "category_id", "frequency");

-- CreateIndex
CREATE INDEX "student_fee_assignments_structure_id_idx" ON "student_fee_assignments"("structure_id");

-- CreateIndex
CREATE INDEX "student_fee_assignments_school_id_idx" ON "student_fee_assignments"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_fee_assignments_student_id_structure_id_key" ON "student_fee_assignments"("student_id", "structure_id");

-- CreateIndex
CREATE UNIQUE INDEX "discounts_school_id_name_key" ON "discounts"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "discounts_id_school_id_key" ON "discounts"("id", "school_id");

-- CreateIndex
CREATE INDEX "scholarship_awards_student_id_status_idx" ON "scholarship_awards"("student_id", "status");

-- CreateIndex
CREATE INDEX "scholarship_awards_school_id_idx" ON "scholarship_awards"("school_id");

-- CreateIndex
CREATE INDEX "invoices_school_id_status_due_date_idx" ON "invoices"("school_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_school_id_invoice_no_key" ON "invoices"("school_id", "invoice_no");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_student_id_academic_year_id_period_label_key" ON "invoices"("student_id", "academic_year_id", "period_label");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_school_id_key" ON "invoices"("id", "school_id");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_items_school_id_idx" ON "invoice_items"("school_id");

-- CreateIndex
CREATE INDEX "payments_student_id_paid_at_idx" ON "payments"("student_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_school_id_paid_at_idx" ON "payments"("school_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_school_id_key" ON "payments"("id", "school_id");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_allocations_school_id_idx" ON "payment_allocations"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_invoice_id_key" ON "payment_allocations"("payment_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_school_id_receipt_no_key" ON "receipts"("school_id", "receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_school_id_key" ON "receipts"("payment_id", "school_id");

-- AddForeignKey
ALTER TABLE "fee_categories" ADD CONSTRAINT "fee_categories_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academic_year_id_school_id_fkey" FOREIGN KEY ("academic_year_id", "school_id") REFERENCES "academic_years"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_class_id_school_id_fkey" FOREIGN KEY ("class_id", "school_id") REFERENCES "classes"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_structure_id_school_id_fkey" FOREIGN KEY ("structure_id", "school_id") REFERENCES "fee_structures"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_category_id_school_id_fkey" FOREIGN KEY ("category_id", "school_id") REFERENCES "fee_categories"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_fee_assignments" ADD CONSTRAINT "student_fee_assignments_structure_id_school_id_fkey" FOREIGN KEY ("structure_id", "school_id") REFERENCES "fee_structures"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_category_id_school_id_fkey" FOREIGN KEY ("category_id", "school_id") REFERENCES "fee_categories"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_awards" ADD CONSTRAINT "scholarship_awards_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_awards" ADD CONSTRAINT "scholarship_awards_discount_id_school_id_fkey" FOREIGN KEY ("discount_id", "school_id") REFERENCES "discounts"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_awards" ADD CONSTRAINT "scholarship_awards_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_awards" ADD CONSTRAINT "scholarship_awards_academic_year_id_school_id_fkey" FOREIGN KEY ("academic_year_id", "school_id") REFERENCES "academic_years"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_academic_year_id_school_id_fkey" FOREIGN KEY ("academic_year_id", "school_id") REFERENCES "academic_years"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_school_id_fkey" FOREIGN KEY ("invoice_id", "school_id") REFERENCES "invoices"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_category_id_school_id_fkey" FOREIGN KEY ("category_id", "school_id") REFERENCES "fee_categories"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_school_id_fkey" FOREIGN KEY ("payment_id", "school_id") REFERENCES "payments"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_school_id_fkey" FOREIGN KEY ("invoice_id", "school_id") REFERENCES "invoices"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_school_id_fkey" FOREIGN KEY ("payment_id", "school_id") REFERENCES "payments"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fee_categories','fee_structures','fee_structure_items','student_fee_assignments','discounts','scholarship_awards','invoices','invoice_items','payments','payment_allocations','receipts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;

-- --- Money rules --------------------------------------------------------------------
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_amount" CHECK (amount > 0);
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_value" CHECK (
  (value_type = 'percentage' AND value > 0 AND value <= 100) OR (value_type = 'fixed' AND value > 0)
);
ALTER TABLE "scholarship_awards" ADD CONSTRAINT "scholarship_awards_validity" CHECK (valid_until >= valid_from);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts" CHECK (
  subtotal >= 0 AND discount_total >= 0 AND discount_total <= subtotal
  AND total = subtotal - discount_total AND amount_paid >= 0 AND amount_paid <= total
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_due_after_issue" CHECK (due_date >= issue_date);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_amounts" CHECK (
  amount >= 0 AND discount >= 0 AND discount <= amount AND net = amount - discount
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount" CHECK (amount > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_void_reason" CHECK (status <> 'voided' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL));
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount" CHECK (amount > 0);
