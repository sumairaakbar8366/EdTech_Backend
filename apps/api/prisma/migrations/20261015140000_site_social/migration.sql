-- AlterTable
ALTER TABLE "school_websites" ADD COLUMN "whatsapp" TEXT,
ADD COLUMN "instagram_url" TEXT,
ADD COLUMN "youtube_url" TEXT,
ADD COLUMN "linkedin_url" TEXT,
ADD COLUMN "tiktok_url" TEXT,
ADD COLUMN "x_url" TEXT;

-- CreateTable
CREATE TABLE "platform_site_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "contact_email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "address" TEXT,
    "facebook_url" TEXT,
    "instagram_url" TEXT,
    "youtube_url" TEXT,
    "linkedin_url" TEXT,
    "tiktok_url" TEXT,
    "x_url" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_site_settings_pkey" PRIMARY KEY ("id")
);
