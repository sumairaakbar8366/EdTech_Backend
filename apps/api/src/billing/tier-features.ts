import { PLAN_FEATURES_LIST, featuresForPlan, type PlanFeature } from '@schoolerp/shared';

type TierWithEntitlements = { code: string; entitlements: { featureKey: string; isEnabled: boolean }[] };

/** A plan's features: what the platform owner set, or the standard set for the four built-in plans. */
export function tierFeatures(tier: TierWithEntitlements): PlanFeature[] {
  if (tier.entitlements.length === 0) return [...featuresForPlan(tier.code)];
  const on = new Set(tier.entitlements.filter((e) => e.isEnabled).map((e) => e.featureKey));
  return PLAN_FEATURES_LIST.filter((f) => on.has(f));
}
