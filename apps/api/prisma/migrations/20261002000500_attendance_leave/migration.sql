-- CreateEnum
CREATE TYPE "student_attendance_status" AS ENUM ('present', 'absent', 'late', 'excused');

-- CreateEnum
CREATE TYPE "geofence_status" AS ENUM ('valid', 'flagged', 'unknown');

-- CreateEnum
CREATE TYPE "attendance_review_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "leave_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "weekly_off_days" INTEGER[] DEFAULT ARRAY[7]::INTEGER[];

-- CreateTable
CREATE TABLE "student_attendance" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "student_attendance_status" NOT NULL,
    "remarks" TEXT,
    "marked_by" UUID,
    "marked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_geofences" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "campus_id" UUID NOT NULL,
    "center_latitude" DECIMAL(10,8) NOT NULL,
    "center_longitude" DECIMAL(11,8) NOT NULL,
    "radius_meters" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campus_geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_attendance" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "check_in_at" TIMESTAMPTZ(3) NOT NULL,
    "check_out_at" TIMESTAMPTZ(3),
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "accuracy_meters" INTEGER,
    "distance_meters" INTEGER,
    "geofence_status" "geofence_status" NOT NULL,
    "device_id" TEXT,
    "review_status" "attendance_review_status",
    "reviewed_by" UUID,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teacher_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "annual_quota" INTEGER,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "leave_status" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_attendance_student_id_marked_at_idx" ON "student_attendance"("student_id", "marked_at");

-- CreateIndex
CREATE INDEX "student_attendance_school_id_idx" ON "student_attendance"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_attendance_session_id_student_id_key" ON "student_attendance"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "campus_geofences_school_id_idx" ON "campus_geofences"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "campus_geofences_one_active_per_campus" ON "campus_geofences"("campus_id") WHERE (is_active);

-- CreateIndex
CREATE INDEX "teacher_attendance_school_id_date_idx" ON "teacher_attendance"("school_id", "date");

-- CreateIndex
CREATE INDEX "teacher_attendance_school_id_review_status_idx" ON "teacher_attendance"("school_id", "review_status");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_attendance_employee_id_date_key" ON "teacher_attendance"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_school_id_code_key" ON "leave_types"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_id_school_id_key" ON "leave_types"("id", "school_id");

-- CreateIndex
CREATE INDEX "leave_requests_employee_id_start_date_idx" ON "leave_requests"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_requests_school_id_status_idx" ON "leave_requests"("school_id", "status");

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_session_id_school_id_fkey" FOREIGN KEY ("session_id", "school_id") REFERENCES "class_sessions"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_geofences" ADD CONSTRAINT "campus_geofences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_geofences" ADD CONSTRAINT "campus_geofences_campus_id_school_id_fkey" FOREIGN KEY ("campus_id", "school_id") REFERENCES "campuses"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_school_id_fkey" FOREIGN KEY ("leave_type_id", "school_id") REFERENCES "leave_types"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_attendance','campus_geofences','teacher_attendance','leave_types','leave_requests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;

-- --- Geofence & check-in rules ---------------------------------------------------
ALTER TABLE "campus_geofences" ADD CONSTRAINT "campus_geofences_coordinates"
  CHECK (center_latitude BETWEEN -90 AND 90 AND center_longitude BETWEEN -180 AND 180);
ALTER TABLE "campus_geofences" ADD CONSTRAINT "campus_geofences_radius" CHECK (radius_meters BETWEEN 10 AND 10000);
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_coordinates"
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_checkout_after_checkin" CHECK (check_out_at IS NULL OR check_out_at >= check_in_at);
-- Flagged/unknown check-ins always carry a review status (page 7 "Admin Review Required").
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_review_needed"
  CHECK (geofence_status = 'valid' OR review_status IS NOT NULL);

-- --- Leave rules ------------------------------------------------------------------
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_quota" CHECK (annual_quota IS NULL OR annual_quota BETWEEN 0 AND 366);
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_date_order" CHECK (end_date >= start_date);
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_days_positive" CHECK (days > 0);
-- An employee cannot have two live (pending/approved) requests covering the same day.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_no_overlap"
  EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('pending', 'approved'));

ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_weekly_off_days"
  CHECK (weekly_off_days <@ ARRAY[1,2,3,4,5,6,7] AND cardinality(weekly_off_days) < 7);
