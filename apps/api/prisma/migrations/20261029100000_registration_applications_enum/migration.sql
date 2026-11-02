-- Applications wait for the owner's team before any school is created.
ALTER TYPE "registration_status" ADD VALUE IF NOT EXISTS 'pending';
