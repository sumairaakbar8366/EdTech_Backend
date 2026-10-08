-- CreateEnum
CREATE TYPE "salary_component_kind" AS ENUM ('earning', 'deduction');

-- CreateEnum
CREATE TYPE "salary_component_calc" AS ENUM ('fixed', 'percent_of_basic');

-- CreateEnum
CREATE TYPE "payroll_run_status" AS ENUM ('draft', 'reviewed', 'approved', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "payroll_deduction_type" AS ENUM ('attendance', 'leave', 'component', 'manual');

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "basic_salary" DECIMAL(12,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "kind" "salary_component_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "calc" "salary_component_calc" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "status" "payroll_run_status" NOT NULL DEFAULT 'draft',
    "apply_attendance" BOOLEAN NOT NULL DEFAULT true,
    "working_days" INTEGER NOT NULL,
    "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "basic" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross" DECIMAL(12,2) NOT NULL,
    "attendance_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "leave_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "working_days" INTEGER NOT NULL,
    "payable_days" INTEGER NOT NULL,
    "present_days" INTEGER NOT NULL,
    "paid_leave_days" INTEGER NOT NULL DEFAULT 0,
    "unpaid_leave_days" INTEGER NOT NULL DEFAULT 0,
    "absent_days" INTEGER NOT NULL DEFAULT 0,
    "earnings" JSONB NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_deductions" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "type" "payroll_deduction_type" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payroll_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "payslip_no" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_structures_employee_id_is_active_idx" ON "salary_structures"("employee_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_id_school_id_key" ON "salary_structures"("id", "school_id");

-- CreateIndex
CREATE INDEX "salary_components_structure_id_idx" ON "salary_components"("structure_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_id_school_id_key" ON "payroll_periods"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_school_id_start_date_end_date_key" ON "payroll_periods"("school_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "payroll_runs_school_id_status_idx" ON "payroll_runs"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_id_school_id_key" ON "payroll_runs"("id", "school_id");

-- CreateIndex
CREATE INDEX "payroll_items_employee_id_idx" ON "payroll_items"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_id_school_id_key" ON "payroll_items"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_run_id_employee_id_key" ON "payroll_items"("run_id", "employee_id");

-- CreateIndex
CREATE INDEX "payroll_deductions_item_id_idx" ON "payroll_deductions"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_payments_item_id_key" ON "payroll_payments"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_payments_item_id_school_id_key" ON "payroll_payments"("item_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_item_id_key" ON "payslips"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_school_id_payslip_no_key" ON "payslips"("school_id", "payslip_no");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_item_id_school_id_key" ON "payslips"("item_id", "school_id");

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_structure_id_school_id_fkey" FOREIGN KEY ("structure_id", "school_id") REFERENCES "salary_structures"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period_id_school_id_fkey" FOREIGN KEY ("period_id", "school_id") REFERENCES "payroll_periods"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_school_id_fkey" FOREIGN KEY ("run_id", "school_id") REFERENCES "payroll_runs"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_deductions" ADD CONSTRAINT "payroll_deductions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_deductions" ADD CONSTRAINT "payroll_deductions_item_id_school_id_fkey" FOREIGN KEY ("item_id", "school_id") REFERENCES "payroll_items"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_item_id_school_id_fkey" FOREIGN KEY ("item_id", "school_id") REFERENCES "payroll_items"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_item_id_school_id_fkey" FOREIGN KEY ("item_id", "school_id") REFERENCES "payroll_items"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One active salary structure per employee; one live (non-cancelled) run per period.
CREATE UNIQUE INDEX "salary_structures_one_active" ON "salary_structures" ("employee_id") WHERE "is_active";
CREATE UNIQUE INDEX "payroll_runs_one_live_per_period" ON "payroll_runs" ("period_id") WHERE "status" <> 'cancelled';

ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_dates_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_basic_check" CHECK ("basic_salary" >= 0);
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_value_check" CHECK ("value" >= 0);
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_net_check" CHECK ("net" >= 0);

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['salary_structures','salary_components','payroll_periods','payroll_runs','payroll_items','payroll_deductions','payroll_payments','payslips']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;
