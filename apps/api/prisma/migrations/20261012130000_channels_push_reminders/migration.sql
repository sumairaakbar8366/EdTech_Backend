




-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "last_reminder_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminder_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "mobile_channel" TEXT NOT NULL DEFAULT 'off';

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_school_id_user_id_idx" ON "push_subscriptions"("school_id", "user_id");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_school_id_fkey" FOREIGN KEY ("user_id", "school_id") REFERENCES "users"("id", "school_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "push_subscriptions" USING (school_id = app_current_school_id()) WITH CHECK (school_id = app_current_school_id());
ALTER TABLE "school_settings" ADD CONSTRAINT "school_settings_mobile_channel" CHECK ("mobile_channel" IN ('off', 'sms', 'whatsapp'));
