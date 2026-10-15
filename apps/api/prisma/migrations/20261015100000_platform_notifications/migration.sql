-- CreateTable
CREATE TABLE "platform_notifications" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "school_id" UUID,
    "actor" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_notifications_created_at_idx" ON "platform_notifications"("created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_notifications_read_at_idx" ON "platform_notifications"("read_at");
