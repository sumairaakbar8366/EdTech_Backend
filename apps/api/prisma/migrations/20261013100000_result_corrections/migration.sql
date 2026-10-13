




-- AlterTable
ALTER TABLE "report_cards" ADD COLUMN     "edited_at" TIMESTAMPTZ(3),
ADD COLUMN     "edited_by_name" TEXT,
ADD COLUMN     "pass_override" BOOLEAN;

-- CreateTable
CREATE TABLE "report_card_changes" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "report_card_id" UUID NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_by_name" TEXT,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_card_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_card_changes_report_card_id_created_at_idx" ON "report_card_changes"("report_card_id", "created_at");

-- AddForeignKey
ALTER TABLE "report_card_changes" ADD CONSTRAINT "report_card_changes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_changes" ADD CONSTRAINT "report_card_changes_report_card_id_fkey" FOREIGN KEY ("report_card_id") REFERENCES "report_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "report_card_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_card_changes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "report_card_changes" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
