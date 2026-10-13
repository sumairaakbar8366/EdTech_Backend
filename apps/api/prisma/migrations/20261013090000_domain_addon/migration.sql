




-- AlterTable
ALTER TABLE "platform_billing_settings" ADD COLUMN     "domain_price_yearly" DECIMAL(12,2) DEFAULT 6000;

-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "custom_domain_until" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'plan',
ALTER COLUMN "tier_id" DROP NOT NULL;


ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_purpose" CHECK (("purpose" = 'plan' AND "tier_id" IS NOT NULL) OR ("purpose" = 'domain' AND "tier_id" IS NULL));
