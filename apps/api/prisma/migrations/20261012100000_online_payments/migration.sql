-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "subscription_payment_status" ADD VALUE 'initiated';
ALTER TYPE "subscription_payment_status" ADD VALUE 'failed';







-- AlterTable
ALTER TABLE "platform_billing_settings" ADD COLUMN     "bank_transfer_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "card_brand" TEXT,
ADD COLUMN     "card_last4" TEXT,
ADD COLUMN     "checkout_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "checkout_token" TEXT,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'bank_transfer',
ADD COLUMN     "paid_at" TIMESTAMPTZ(3),
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "provider_txn_id" TEXT,
ALTER COLUMN "payer_name" DROP NOT NULL,
ALTER COLUMN "payer_bank" DROP NOT NULL,
ALTER COLUMN "payer_account" DROP NOT NULL,
ALTER COLUMN "reference" DROP NOT NULL,
ALTER COLUMN "paid_on" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_checkout_token_key" ON "subscription_payments"("checkout_token");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_provider_provider_txn_id_key" ON "subscription_payments"("provider", "provider_txn_id");

