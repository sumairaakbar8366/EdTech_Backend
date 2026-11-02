CREATE TABLE IF NOT EXISTS "leadership_seats" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title_key" TEXT NOT NULL,
    "title_label" TEXT NOT NULL,
    "hidden_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "leadership_seats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "leadership_seats_user_id_key" ON "leadership_seats"("user_id");
CREATE INDEX IF NOT EXISTS "leadership_seats_school_id_idx" ON "leadership_seats"("school_id");
ALTER TABLE "leadership_seats" ADD CONSTRAINT "leadership_seats_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leadership_seats" ADD CONSTRAINT "leadership_seats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leadership_seats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leadership_seats" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leadership_seats" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
