ALTER TABLE "scholarship_programs"
  ADD COLUMN "target_levels" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "period" TEXT NOT NULL DEFAULT 'yearly',
  ADD COLUMN "current_period" TEXT,
  ADD COLUMN "continues_to_undergrad" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "min_average" INTEGER NOT NULL DEFAULT 70,
  ADD COLUMN "min_attendance" INTEGER NOT NULL DEFAULT 85,
  ADD COLUMN "need_required" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "scholarship_candidates" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "request_id" UUID,
    "period_label" TEXT NOT NULL,
    "student_ref" UUID NOT NULL,
    "student_name" TEXT NOT NULL,
    "class_name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "average" DOUBLE PRECISION NOT NULL,
    "attendance" DOUBLE PRECISION NOT NULL,
    "merit_score" INTEGER NOT NULL,
    "need_score" INTEGER NOT NULL,
    "rank_score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "need_note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "grant_id" UUID,
    "confirmed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    CONSTRAINT "scholarship_candidates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "scholarship_candidates_program_id_school_id_student_ref_period_label_key" ON "scholarship_candidates"("program_id", "school_id", "student_ref", "period_label");
CREATE INDEX "scholarship_candidates_program_id_period_label_status_idx" ON "scholarship_candidates"("program_id", "period_label", "status");
CREATE INDEX "scholarship_candidates_school_id_idx" ON "scholarship_candidates"("school_id");
ALTER TABLE "scholarship_candidates" ADD CONSTRAINT "scholarship_candidates_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "scholarship_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scholarship_candidates" ADD CONSTRAINT "scholarship_candidates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
