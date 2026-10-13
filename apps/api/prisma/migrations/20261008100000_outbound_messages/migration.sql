-- CreateEnum
CREATE TYPE "delivery_channel" AS ENUM ('email', 'sms', 'whatsapp', 'push');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('queued', 'sent', 'failed');

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "school_id" UUID,
    "channel" "delivery_channel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT,
    "status" "delivery_status" NOT NULL DEFAULT 'queued',
    "provider" TEXT,
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_messages_created_at_idx" ON "outbound_messages"("created_at" DESC);

-- CreateIndex
CREATE INDEX "outbound_messages_school_id_created_at_idx" ON "outbound_messages"("school_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "outbound_messages_status_idx" ON "outbound_messages"("status");

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

