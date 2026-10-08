-- CreateEnum
CREATE TYPE "staff_type" AS ENUM ('teaching', 'non_teaching');

-- CreateEnum
CREATE TYPE "employment_type" AS ENUM ('full_time', 'part_time', 'contract');

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('active', 'on_leave', 'resigned', 'terminated');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('male', 'female', 'other');

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "user_id" UUID,
    "employee_no" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "gender" "gender",
    "date_of_birth" DATE,
    "staff_type" "staff_type" NOT NULL,
    "designation" TEXT NOT NULL,
    "department" TEXT,
    "employment_type" "employment_type" NOT NULL DEFAULT 'full_time',
    "join_date" DATE NOT NULL,
    "status" "employee_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_profiles" (
    "employee_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "address" TEXT,
    "national_id" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "blood_group" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "employee_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "specialization" TEXT,
    "bio" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "teacher_qualifications" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "degree" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "year_completed" INTEGER,
    "grade" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_experiences" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "organization" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_status_history" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "from_status" "employee_status",
    "to_status" "employee_status" NOT NULL,
    "reason" TEXT,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_assignments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_school_id_staff_type_status_idx" ON "employees"("school_id", "staff_type", "status");

-- CreateIndex
CREATE INDEX "employees_campus_id_idx" ON "employees"("campus_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_school_id_key" ON "employees"("user_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_school_id_employee_no_key" ON "employees"("school_id", "employee_no");

-- CreateIndex
CREATE UNIQUE INDEX "employees_school_id_email_key" ON "employees"("school_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_id_school_id_key" ON "employees"("id", "school_id");

-- CreateIndex
CREATE INDEX "employee_profiles_school_id_idx" ON "employee_profiles"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_employee_id_school_id_key" ON "employee_profiles"("employee_id", "school_id");

-- CreateIndex
CREATE INDEX "teacher_profiles_school_id_idx" ON "teacher_profiles"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_employee_id_school_id_key" ON "teacher_profiles"("employee_id", "school_id");

-- CreateIndex
CREATE INDEX "teacher_qualifications_employee_id_idx" ON "teacher_qualifications"("employee_id");

-- CreateIndex
CREATE INDEX "teacher_qualifications_school_id_idx" ON "teacher_qualifications"("school_id");

-- CreateIndex
CREATE INDEX "teacher_experiences_employee_id_idx" ON "teacher_experiences"("employee_id");

-- CreateIndex
CREATE INDEX "teacher_experiences_school_id_idx" ON "teacher_experiences"("school_id");

-- CreateIndex
CREATE INDEX "employee_status_history_employee_id_changed_at_idx" ON "employee_status_history"("employee_id", "changed_at");

-- CreateIndex
CREATE INDEX "employee_status_history_school_id_idx" ON "employee_status_history"("school_id");

-- CreateIndex
CREATE INDEX "teacher_assignments_employee_id_idx" ON "teacher_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "teacher_assignments_section_id_idx" ON "teacher_assignments"("section_id");

-- CreateIndex
CREATE INDEX "teacher_assignments_school_id_idx" ON "teacher_assignments"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_assignments_academic_year_id_section_id_subject_id_key" ON "teacher_assignments"("academic_year_id", "section_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_school_id_key" ON "sections"("id", "school_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_campus_id_school_id_fkey" FOREIGN KEY ("campus_id", "school_id") REFERENCES "campuses"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_school_id_fkey" FOREIGN KEY ("user_id", "school_id") REFERENCES "users"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_qualifications" ADD CONSTRAINT "teacher_qualifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_qualifications" ADD CONSTRAINT "teacher_qualifications_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_experiences" ADD CONSTRAINT "teacher_experiences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_experiences" ADD CONSTRAINT "teacher_experiences_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_status_history" ADD CONSTRAINT "employee_status_history_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_status_history" ADD CONSTRAINT "employee_status_history_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_academic_year_id_school_id_fkey" FOREIGN KEY ("academic_year_id", "school_id") REFERENCES "academic_years"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_section_id_school_id_fkey" FOREIGN KEY ("section_id", "school_id") REFERENCES "sections"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_subject_id_school_id_fkey" FOREIGN KEY ("subject_id", "school_id") REFERENCES "subjects"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','employee_profiles','teacher_profiles','teacher_qualifications',
                           'teacher_experiences','employee_status_history','teacher_assignments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;

-- --- Value rules ----------------------------------------------------------------
ALTER TABLE "employees" ADD CONSTRAINT "employees_email_lowercase" CHECK (email IS NULL OR email = lower(email));
ALTER TABLE "employees" ADD CONSTRAINT "employees_dob_before_join" CHECK (date_of_birth IS NULL OR date_of_birth < join_date);
ALTER TABLE "teacher_experiences" ADD CONSTRAINT "teacher_experiences_date_order" CHECK (end_date IS NULL OR end_date >= start_date);
ALTER TABLE "teacher_qualifications" ADD CONSTRAINT "teacher_qualifications_year_range" CHECK (year_completed IS NULL OR year_completed BETWEEN 1950 AND 2100);
