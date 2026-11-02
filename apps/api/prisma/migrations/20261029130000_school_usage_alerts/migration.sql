CREATE TABLE IF NOT EXISTS "school_usage_alerts" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "used" INTEGER NOT NULL,
    "limit" INTEGER NOT NULL,
    "first_over_at" TIMESTAMPTZ(3),
    "grace_ends_at" TIMESTAMPTZ(3),
    "notified_level" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "school_usage_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "school_usage_alerts_school_id_metric_key" ON "school_usage_alerts"("school_id", "metric");
ALTER TABLE "school_usage_alerts" ADD CONSTRAINT "school_usage_alerts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
