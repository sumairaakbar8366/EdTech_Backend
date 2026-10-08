-- CreateEnum
CREATE TYPE "material_type" AS ENUM ('pdf', 'document', 'video', 'image', 'link');

-- CreateEnum
CREATE TYPE "submission_mode" AS ENUM ('file', 'text', 'file_or_text');

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('submitted', 'graded');



-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_materials" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "file_type" "material_type" NOT NULL,
    "file_key" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "file_url" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "course_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_comments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "parent_comment_id" UUID,
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "material_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "max_marks" DECIMAL(6,2) NOT NULL,
    "allow_late" BOOLEAN NOT NULL DEFAULT true,
    "mode" "submission_mode" NOT NULL DEFAULT 'file_or_text',
    "file_key" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "text_body" TEXT,
    "file_key" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "status" "submission_status" NOT NULL DEFAULT 'submitted',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "marks" DECIMAL(6,2) NOT NULL,
    "feedback" TEXT,
    "graded_by" UUID NOT NULL,
    "graded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courses_section_id_idx" ON "courses"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_id_school_id_key" ON "courses"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_academic_year_id_section_id_subject_id_key" ON "courses"("academic_year_id", "section_id", "subject_id");

-- CreateIndex
CREATE INDEX "course_materials_course_id_created_at_idx" ON "course_materials"("course_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "course_materials_id_school_id_key" ON "course_materials"("id", "school_id");

-- CreateIndex
CREATE INDEX "material_comments_material_id_created_at_idx" ON "material_comments"("material_id", "created_at");

-- CreateIndex
CREATE INDEX "assignments_course_id_due_at_idx" ON "assignments"("course_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_id_school_id_key" ON "assignments"("id", "school_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_student_id_idx" ON "assignment_submissions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_id_school_id_key" ON "assignment_submissions"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_student_id_key" ON "assignment_submissions"("assignment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_submission_id_key" ON "grades"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_submission_id_school_id_key" ON "grades"("submission_id", "school_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_academic_year_id_school_id_fkey" FOREIGN KEY ("academic_year_id", "school_id") REFERENCES "academic_years"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_section_id_school_id_fkey" FOREIGN KEY ("section_id", "school_id") REFERENCES "sections"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_subject_id_school_id_fkey" FOREIGN KEY ("subject_id", "school_id") REFERENCES "subjects"("id", "school_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_course_id_school_id_fkey" FOREIGN KEY ("course_id", "school_id") REFERENCES "courses"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_comments" ADD CONSTRAINT "material_comments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_comments" ADD CONSTRAINT "material_comments_material_id_school_id_fkey" FOREIGN KEY ("material_id", "school_id") REFERENCES "course_materials"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_comments" ADD CONSTRAINT "material_comments_user_id_school_id_fkey" FOREIGN KEY ("user_id", "school_id") REFERENCES "users"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_comments" ADD CONSTRAINT "material_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "material_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_id_school_id_fkey" FOREIGN KEY ("course_id", "school_id") REFERENCES "courses"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_school_id_fkey" FOREIGN KEY ("assignment_id", "school_id") REFERENCES "assignments"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_school_id_fkey" FOREIGN KEY ("student_id", "school_id") REFERENCES "students"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_submission_id_school_id_fkey" FOREIGN KEY ("submission_id", "school_id") REFERENCES "assignment_submissions"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A material is either an upload or a link; marks stay within the assignment maximum (checked in the service).
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_source_check" CHECK (("file_key" IS NOT NULL) <> ("file_url" IS NOT NULL));
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_max_marks_check" CHECK ("max_marks" > 0);
ALTER TABLE "grades" ADD CONSTRAINT "grades_marks_check" CHECK ("marks" >= 0);

-- --- Row-level security (see 20261001000100_tenant_rls for the convention) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['courses','course_materials','material_comments','assignments','assignment_submissions','grades']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id())', t);
  END LOOP;
END
$$;
