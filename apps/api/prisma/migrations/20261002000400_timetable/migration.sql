-- CreateEnum
CREATE TYPE "class_session_status" AS ENUM ('live', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "timetable_slots" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "room_id" UUID,
    "day_of_week" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "timetable_slot_id" UUID,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "status" "class_session_status" NOT NULL DEFAULT 'live',
    "topic" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timetable_slots_academic_year_id_section_id_day_of_week_idx" ON "timetable_slots"("academic_year_id", "section_id", "day_of_week");

-- CreateIndex
CREATE INDEX "timetable_slots_academic_year_id_employee_id_day_of_week_idx" ON "timetable_slots"("academic_year_id", "employee_id", "day_of_week");

-- CreateIndex
CREATE INDEX "timetable_slots_school_id_idx" ON "timetable_slots"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_slots_id_school_id_key" ON "timetable_slots"("id", "school_id");

-- CreateIndex
CREATE INDEX "class_sessions_school_id_session_date_idx" ON "class_sessions"("school_id", "session_date");

-- CreateIndex
CREATE INDEX "class_sessions_employee_id_session_date_idx" ON "class_sessions"("employee_id", "session_date");

-- CreateIndex
CREATE INDEX "class_sessions_section_id_session_date_idx" ON "class_sessions"("section_id", "session_date");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_timetable_slot_id_session_date_key" ON "class_sessions"("timetable_slot_id", "session_date");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_id_school_id_key" ON "class_sessions"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_id_school_id_key" ON "rooms"("id", "school_id");

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_academic_year_id_school_id_fkey" FOREIGN KEY ("academic_year_id", "school_id") REFERENCES "academic_years"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_section_id_school_id_fkey" FOREIGN KEY ("section_id", "school_id") REFERENCES "sections"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_subject_id_school_id_fkey" FOREIGN KEY ("subject_id", "school_id") REFERENCES "subjects"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_room_id_school_id_fkey" FOREIGN KEY ("room_id", "school_id") REFERENCES "rooms"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_timetable_slot_id_school_id_fkey" FOREIGN KEY ("timetable_slot_id", "school_id") REFERENCES "timetable_slots"("id", "school_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_section_id_school_id_fkey" FOREIGN KEY ("section_id", "school_id") REFERENCES "sections"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_subject_id_school_id_fkey" FOREIGN KEY ("subject_id", "school_id") REFERENCES "subjects"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_employee_id_school_id_fkey" FOREIGN KEY ("employee_id", "school_id") REFERENCES "employees"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['timetable_slots','class_sessions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;

-- --- Slot rules -------------------------------------------------------------------
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_day" CHECK (day_of_week BETWEEN 1 AND 7);
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_time_range"
  CHECK (start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute);
-- No overlapping periods for the same section, teacher or room (half-open ranges, so back-to-back is fine).
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_section_no_overlap"
  EXCLUDE USING gist (academic_year_id WITH =, section_id WITH =, day_of_week WITH =, int4range(start_minute, end_minute) WITH &&);
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_teacher_no_overlap"
  EXCLUDE USING gist (academic_year_id WITH =, employee_id WITH =, day_of_week WITH =, int4range(start_minute, end_minute) WITH &&);
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_room_no_overlap"
  EXCLUDE USING gist (academic_year_id WITH =, room_id WITH =, day_of_week WITH =, int4range(start_minute, end_minute) WITH &&)
  WHERE (room_id IS NOT NULL);

-- --- Session rules ----------------------------------------------------------------
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_end_after_start" CHECK (ended_at IS NULL OR ended_at >= started_at);
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_completed_has_end" CHECK (status <> 'completed' OR ended_at IS NOT NULL);
-- A teacher can run only one live class at a time.
CREATE UNIQUE INDEX "class_sessions_one_live_per_teacher" ON "class_sessions" ("employee_id") WHERE (status = 'live');
