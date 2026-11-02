/**
 * How the platform owner tunes applications: how long the free trial is for a school of a given
 * size, which proofs are required, and which choices the form offers. Stored with the registration
 * form (platform_forms.settings) and always read through `readPolicy`, so a missing or damaged
 * setting falls back to the defaults.
 */

export interface TrialBand {
  /** The band covers schools with up to this many people (students + teachers + staff); null = no upper limit. */
  upTo: number | null;
  days: number;
  label: string;
}

export interface RegistrationPolicy {
  trialBands: TrialBand[];
  /** WhatsApp code to the owner's mobile number. */
  requirePhoneCode: boolean;
  allowedCountries: string[];
  schoolTypes: string[];
  minStudents: number;
  maxStudents: number;
}

export const DEFAULT_POLICY: RegistrationPolicy = {
  trialBands: [
    { upTo: 100, days: 14, label: 'Small school (up to 100 people)' },
    { upTo: 500, days: 21, label: 'Medium school (101–500 people)' },
    { upTo: 2000, days: 30, label: 'Large school (501–2,000 people)' },
    { upTo: null, days: 45, label: 'Very large school / group (2,000+ people)' },
  ],
  requirePhoneCode: true,
  allowedCountries: ['Pakistan'],
  schoolTypes: ['Primary', 'Middle', 'Secondary / High', 'Higher secondary / College', 'Montessori / Preschool', 'Academy / Coaching', 'Other'],
  minStudents: 5,
  maxStudents: 200_000,
};

const int = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback);
const strings = (v: unknown, fallback: string[]) => (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' && x.trim()) ? [...new Set((v as string[]).map((x) => x.trim()))] : fallback);

export function readPolicy(raw: unknown): RegistrationPolicy {
  const r = raw && typeof raw === 'object' ? (raw as Partial<RegistrationPolicy>) : {};
  const bands = Array.isArray(r.trialBands)
    ? r.trialBands
        .filter((b): b is TrialBand => !!b && typeof b.days === 'number' && b.days >= 1 && b.days <= 365 && (b.upTo === null || (typeof b.upTo === 'number' && b.upTo >= 1)))
        .map((b) => ({ upTo: b.upTo, days: Math.round(b.days), label: String(b.label ?? '').slice(0, 80) || (b.upTo ? `Up to ${b.upTo} people` : 'Larger schools') }))
    : [];
  // Bands are tried smallest first; the last must be open-ended so every school gets one.
  const sorted = bands.sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const valid = sorted.length > 0 && sorted[sorted.length - 1]!.upTo === null;
  return {
    trialBands: valid ? sorted : DEFAULT_POLICY.trialBands,
    requirePhoneCode: typeof r.requirePhoneCode === 'boolean' ? r.requirePhoneCode : DEFAULT_POLICY.requirePhoneCode,
    allowedCountries: strings(r.allowedCountries, DEFAULT_POLICY.allowedCountries),
    schoolTypes: strings(r.schoolTypes, DEFAULT_POLICY.schoolTypes),
    minStudents: int(r.minStudents, 1, 1000, DEFAULT_POLICY.minStudents),
    maxStudents: int(r.maxStudents, 10, 1_000_000, DEFAULT_POLICY.maxStudents),
  };
}

/** The trial a school of this size earns. */
export function trialFor(policy: RegistrationPolicy, people: number): TrialBand {
  return policy.trialBands.find((b) => b.upTo === null || people <= b.upTo) ?? policy.trialBands[policy.trialBands.length - 1]!;
}
