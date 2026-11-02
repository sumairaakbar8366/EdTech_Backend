-- AlterTable
ALTER TABLE "announcements" ADD COLUMN "target_user_ids" UUID[] DEFAULT ARRAY[]::UUID[];
