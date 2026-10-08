// Subscription tiers and free trial. Source: architecture board, page 1 (Subscription & Billing).
// Prices are not defined by the blueprint; they are set by the platform admin.

export const PRICING_MODELS = ['flat', 'per_campus', 'campus_plus_students', 'custom'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export interface TierDefinition {
  code: string;
  name: string;
  /** `null` = unlimited */
  maxCampuses: number | null;
  maxStudents: number | null;
  maxStaff: number | null;
  pricingModel: PricingModel;
  sortOrder: number;
}

// prettier-ignore
export const DEFAULT_TIERS: readonly TierDefinition[] = [
  { code: 'starter', name: 'Starter', maxCampuses: 1, maxStudents: 300, maxStaff: 25, pricingModel: 'flat', sortOrder: 1 },
  { code: 'growth', name: 'Growth', maxCampuses: 3, maxStudents: 1000, maxStaff: 100, pricingModel: 'per_campus', sortOrder: 2 },
  { code: 'scale', name: 'Scale', maxCampuses: 10, maxStudents: 5000, maxStaff: 500, pricingModel: 'campus_plus_students', sortOrder: 3 },
  { code: 'enterprise', name: 'Enterprise', maxCampuses: null, maxStudents: null, maxStaff: null, pricingModel: 'custom', sortOrder: 4 },
];

/** Every new school tenant receives a 1-month full-featured free trial. */
export const TRIAL_LENGTH_MONTHS = 1;

/**
 * Adds calendar months in UTC, clamping to the last day of the target month
 * (e.g. Jan 31 + 1 month = Feb 28/29), which is the standard billing convention.
 */
export function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}

export function trialPeriod(start: Date): { trialStartsAt: Date; trialEndsAt: Date } {
  return { trialStartsAt: start, trialEndsAt: addMonthsUtc(start, TRIAL_LENGTH_MONTHS) };
}
