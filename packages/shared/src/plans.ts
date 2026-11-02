// Plan features (approved 2026-10-07): the trial includes everything; each paid plan unlocks a set.
// After the trial (or a paid period) ends there is a short grace period with full access, then the
// school is read-only until it pays: data is kept, sign-in and daily basics keep working.

export const PLAN_FEATURES_LIST = [
  'core',
  'website',
  'exams',
  'lms',
  'payroll',
  'document_requests',
  'import_export',
  'gps_attendance',
  'custom_domain',
  'theme',
  'multi_campus',
  'leadership_roles',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES_LIST)[number];

/** What each plan code includes. Unknown/custom plans get everything. */
export const PLAN_FEATURES: Record<string, readonly PlanFeature[]> = {
  starter: ['core', 'website'],
  growth: ['core', 'website', 'exams', 'lms', 'payroll', 'document_requests', 'import_export', 'gps_attendance', 'leadership_roles'],
  scale: ['core', 'website', 'exams', 'lms', 'payroll', 'document_requests', 'import_export', 'gps_attendance', 'custom_domain', 'theme', 'multi_campus', 'leadership_roles'],
  enterprise: [...PLAN_FEATURES_LIST],
};

export function featuresForPlan(code: string | null | undefined): readonly PlanFeature[] {
  return (code && PLAN_FEATURES[code]) || PLAN_FEATURES_LIST;
}

/** Days of full access after the trial or a paid period ends, before the school is locked (user decision 2026-10-08). */
export const GRACE_DAYS = 3;

export const FEATURE_INFO: Record<PlanFeature, { label: string; description: string; plan: string }> = {
  core: { label: 'Core school management', description: 'Students, staff, admissions, attendance, timetable, fees and communication.', plan: 'starter' },
  website: { label: 'School website', description: 'A public website built from your data, with online admission and job applications and a photo gallery.', plan: 'starter' },
  exams: { label: 'Exams & report cards', description: 'Marks entry, grading, published results and printable report cards.', plan: 'growth' },
  lms: { label: 'Learning (LMS)', description: 'Courses, learning material, assignments, submissions and grading.', plan: 'growth' },
  payroll: { label: 'Payroll', description: 'Salary structures, monthly runs with approval, payslips and staff bank accounts.', plan: 'growth' },
  document_requests: { label: 'Online document requests', description: 'Parents and students request marksheets and certificates; the office processes them online.', plan: 'growth' },
  import_export: { label: 'Excel import & export', description: 'Bring your existing data in from Excel/CSV and export any list.', plan: 'growth' },
  gps_attendance: { label: 'GPS staff attendance', description: 'Staff check in from campus with location; the office reviews flagged check-ins.', plan: 'growth' },
  custom_domain: { label: 'Your own domain', description: 'Run your website and portal on your school’s own domain name.', plan: 'scale' },
  theme: { label: 'Your theme colour', description: 'Brand the portal and website with your school’s own colour and logo.', plan: 'scale' },
  leadership_roles: { label: 'Director, Vice Principal & more', description: 'Give directors, vice principals and other senior roles their own login and dashboard, shaped by you.', plan: 'growth' },
  multi_campus: { label: 'Multiple campuses', description: 'Run branches from one account, up to your plan’s campus limit.', plan: 'scale' },
};

export type SubscriptionPhase = 'trial' | 'active' | 'grace' | 'expired';

// --- Plan size limits -------------------------------------------------------------------------
/** Stored files (documents, photos) a plan includes, in MB. Plans not listed (custom, enterprise) are not limited. */
export const STORAGE_MB_BY_PLAN: Record<string, number> = { starter: 1_000, growth: 10_000, scale: 50_000 };
/** A school is warned from this share of a limit… */
export const USAGE_WARN_RATIO = 0.8;
/** …and has this many days after going over to change plan before its access is paused. */
export const USAGE_GRACE_DAYS = 14;
