-- Self-service sign-ups are recorded as onboarded applications so the owner sees who registered.
ALTER TABLE "school_applications" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'application';
