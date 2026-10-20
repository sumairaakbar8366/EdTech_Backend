-- Fingerprints of profile pictures, to refuse a picture already used for someone else.
CREATE TABLE "photo_fingerprints" (
    "photo_key" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "dhash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "photo_fingerprints_pkey" PRIMARY KEY ("photo_key")
);
CREATE INDEX "photo_fingerprints_school_id_sha256_idx" ON "photo_fingerprints"("school_id", "sha256");
ALTER TABLE "photo_fingerprints" ADD CONSTRAINT "photo_fingerprints_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "photo_fingerprints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "photo_fingerprints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "photo_fingerprints" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
