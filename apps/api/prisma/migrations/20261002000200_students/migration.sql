-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('active', 'inactive', 'graduated', 'withdrawn');

-- CreateEnum
CREATE TYPE "guardian_relation" AS ENUM ('father', 'mother', 'guardian', 'grandparent', 'sibling', 'other');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('enrolled', 'promoted', 'completed', 'withdrawn');

-- CreateEnum
CREATE TYPE "document_owner_type" AS ENUM ('student', 'employee', 'guardian', 'admission_application', 'school');

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "admission_no" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "gender" "gender",
    "date_of_birth" DATE NOT NULL,
    "admission_date" DATE NOT NULL,
    "status" "student_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "blood_group" TEXT,
    "national_id" TEXT,
    "religion" TEXT,
    "nationality" TEXT,
    "address" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "occupation" TEXT,
    "national_id" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "student_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "relationship" "guardian_relation" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "student_enrollments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "roll_no" INTEGER,
    "status" "enrollment_status" NOT NULL DEFAULT 'enrolled',
    "enrolled_on" DATE NOT NULL,
    "ended_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_previous_schools" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_name" TEXT NOT NULL,
    "last_class" TEXT,
    "left_on" DATE,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_previous_schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_medical_records" (
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "allergies" TEXT,
    "conditions" TEXT,
    "medications" TEXT,
    "doctor_name" TEXT,
    "doctor_phone" TEXT,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "student_medical_records_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "student_emergency_contacts" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "owner_type" "document_owner_type" NOT NULL,
    "owner_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

-- CreateIndex
CREATE INDEX "students_school_id_status_idx" ON "students"("school_id", "status");

-- CreateIndex
CREATE INDEX "students_school_id_last_name_first_name_idx" ON "students"("school_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_admission_no_key" ON "students"("school_id", "admission_no");

-- CreateIndex
CREATE UNIQUE INDEX "students_id_school_id_key" ON "students"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_school_id_key" ON "students"("user_id", "school_id");

-- CreateIndex
CREATE INDEX "student_profiles_school_id_idx" ON "student_profiles"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_student_id_school_id_key" ON "student_profiles"("student_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_user_id_key" ON "guardians"("user_id");

-- CreateIndex
CREATE INDEX "guardians_school_id_phone_idx" ON "guardians"("school_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_school_id_email_key" ON "guardians"("school_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_id_school_id_key" ON "guardians"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_user_id_school_id_key" ON "guardians"("user_id", "school_id");

-- CreateIndex
CREATE INDEX "student_guardians_guardian_id_idx" ON "student_guardians"("guardian_id");

-- CreateIndex
CREATE INDEX "student_guardians_school_id_idx" ON "student_guardians"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_guardians_one_primary" ON "student_guardians"("student_id") WHERE (is_primary);

-- CreateIndex
CREATE INDEX "student_enrollments_section_id_academic_year_id_idx" ON "student_enrollments"("section_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "student_enrollments_school_id_idx" ON "student_enrollments"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_student_id_academic_year_id_key" ON "student_enrollments"("student_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_academic_year_id_section_id_roll_no_key" ON "student_enrollments"("academic_year_id", "section_id", "roll_no");

-- CreateIndex
CREATE INDEX "student_previous_schools_student_id_idx" ON "student_previous_schools"("student_id");

-- CreateIndex
CREATE INDEX "student_previous_schools_school_id_idx" ON "student_previous_schools"("school_id");

-- CreateIndex
CREATE INDEX "student_medical_records_school_id_idx" ON "student_medical_records"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_medical_records_student_id_school_id_key" ON "student_medical_records"("student_id", "school_id");

-- CreateIndex
CREATE INDEX "student_emergency_contacts_student_id_idx" ON "student_emergency_contacts"("student_id");

-- CreateIndex
CREATE INDEX "student_emergency_contacts_school_id_idx" ON "student_emergency_contacts"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_school_id_owner_type_owner_id_idx" ON "documents"("school_id", "owner_type", "owner_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_school_id_fkey" FOREIGN KEY ("user_id", "school_id") REFERENCES "users"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_school_id_fkey" FOREIGN KEY ("user_id", "school_id") REFERENCES "users"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_school_id_fkey" FOREIGN KEY ("guardian_id", "school_id") REFERENCES "guardians"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_academic_year_id_school_id_fkey" FOREIGN KEY ("academic_year_id", "school_id") REFERENCES "academic_years"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_school_id_fkey" FOREIGN KEY ("section_id", "school_id") REFERENCES "sections"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_previous_schools" ADD CONSTRAINT "student_previous_schools_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_previous_schools" ADD CONSTRAINT "student_previous_schools_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_medical_records" ADD CONSTRAINT "student_medical_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_medical_records" ADD CONSTRAINT "student_medical_records_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_emergency_contacts" ADD CONSTRAINT "student_emergency_contacts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_emergency_contacts" ADD CONSTRAINT "student_emergency_contacts_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['students','student_profiles','guardians','student_guardians','student_enrollments','student_previous_schools','student_medical_records','student_emergency_contacts','documents']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;

-- --- Value rules ----------------------------------------------------------------
ALTER TABLE "students" ADD CONSTRAINT "students_dob_before_admission" CHECK (date_of_birth < admission_date);
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_email_lowercase" CHECK (email IS NULL OR email = lower(email));
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_roll_positive" CHECK (roll_no IS NULL OR roll_no > 0);
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_date_order" CHECK (ended_on IS NULL OR ended_on >= enrolled_on);
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_positive" CHECK (size_bytes > 0);
