ALTER TABLE "school_applications"
ADD COLUMN "designation" TEXT NOT NULL DEFAULT 'School administrator',
ADD COLUMN "school_city" TEXT,
ADD COLUMN "school_website" TEXT;

ALTER TABLE "school_applications" ALTER COLUMN "designation" DROP DEFAULT;