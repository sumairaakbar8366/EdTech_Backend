-- Each school designs its own online admission form and may publish its fee structures.
ALTER TABLE "school_websites" ADD COLUMN "admission_form" JSONB;
ALTER TABLE "school_websites" ADD COLUMN "fees_public" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "school_websites" ADD COLUMN "fee_note" TEXT;

-- Answers to the school's own form fields: one typed row per answer.
CREATE TABLE "admission_answers" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "field_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "save_to" TEXT,
    "value_text" TEXT,
    "value_number" DOUBLE PRECISION,
    "value_date" DATE,
    "value_bool" BOOLEAN,
    "value_list" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "document_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admission_answers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admission_answers_application_id_field_id_key" ON "admission_answers"("application_id", "field_id");
CREATE INDEX "admission_answers_school_id_idx" ON "admission_answers"("school_id");
ALTER TABLE "admission_answers" ADD CONSTRAINT "admission_answers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admission_answers" ADD CONSTRAINT "admission_answers_application_id_school_id_fkey" FOREIGN KEY ("application_id", "school_id") REFERENCES "admission_applications"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admission_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admission_answers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "admission_answers" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
