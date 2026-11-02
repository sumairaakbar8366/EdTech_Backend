ALTER TABLE "complaints" ADD COLUMN "sent_to" TEXT;

CREATE TABLE "complaint_recipients" (
    "complaint_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    CONSTRAINT "complaint_recipients_pkey" PRIMARY KEY ("complaint_id","user_id")
);
CREATE INDEX "complaint_recipients_school_id_user_id_idx" ON "complaint_recipients"("school_id", "user_id");
ALTER TABLE "complaint_recipients" ADD CONSTRAINT "complaint_recipients_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complaint_recipients" ADD CONSTRAINT "complaint_recipients_complaint_id_school_id_fkey" FOREIGN KEY ("complaint_id", "school_id") REFERENCES "complaints"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "complaint_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "complaint_recipients" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "complaint_recipients" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
