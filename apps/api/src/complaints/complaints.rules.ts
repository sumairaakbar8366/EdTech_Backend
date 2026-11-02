/**
 * Complaint rules that do not touch the database: what can be complained about, who may see a
 * complaint, and how serious it is by default. Kept apart so they can be tested on their own.
 */

export type Severity = 'low' | 'normal' | 'high' | 'urgent';

export const CATEGORIES = [
  { key: 'harassment', label: 'Harassment or inappropriate behaviour', group: 'Safety & wellbeing', severity: 'urgent' },
  { key: 'abuse', label: 'Physical abuse or corporal punishment', group: 'Safety & wellbeing', severity: 'urgent' },
  { key: 'bullying', label: 'Bullying or intimidation', group: 'Safety & wellbeing', severity: 'high' },
  { key: 'discrimination', label: 'Discrimination or unfair treatment', group: 'Safety & wellbeing', severity: 'high' },
  { key: 'cyber', label: 'Online / cyber harassment', group: 'Safety & wellbeing', severity: 'high' },
  { key: 'safety', label: 'Safety, security or health hazard', group: 'Safety & wellbeing', severity: 'high' },
  { key: 'mental_health', label: 'Mental health or wellbeing concern', group: 'Safety & wellbeing', severity: 'high' },
  { key: 'corruption', label: 'Corruption, bribery or misuse of funds', group: 'Conduct', severity: 'high' },
  { key: 'teacher_conduct', label: 'Teacher or staff conduct', group: 'Conduct', severity: 'normal' },
  { key: 'student_conduct', label: 'Student behaviour', group: 'Conduct', severity: 'normal' },
  { key: 'parent_conduct', label: 'Parent behaviour', group: 'Conduct', severity: 'normal' },
  { key: 'academic', label: 'Marks, grading or exam unfairness', group: 'Academics', severity: 'normal' },
  { key: 'teaching_quality', label: 'Teaching quality or missed classes', group: 'Academics', severity: 'normal' },
  { key: 'homework', label: 'Homework or workload', group: 'Academics', severity: 'low' },
  { key: 'attendance_leave', label: 'Attendance or leave issue', group: 'Administration', severity: 'normal' },
  { key: 'fees', label: 'Fees, billing or payments', group: 'Administration', severity: 'normal' },
  { key: 'admission', label: 'Admission or enrollment', group: 'Administration', severity: 'normal' },
  { key: 'workplace', label: 'Workplace: salary, workload or colleagues', group: 'Administration', severity: 'normal' },
  { key: 'privacy', label: 'Privacy or data concern', group: 'Administration', severity: 'normal' },
  { key: 'facilities', label: 'Facilities, cleanliness or maintenance', group: 'Facilities', severity: 'low' },
  { key: 'transport', label: 'Transport', group: 'Facilities', severity: 'normal' },
  { key: 'canteen', label: 'Canteen or food', group: 'Facilities', severity: 'low' },
  { key: 'communication', label: 'Communication from the school', group: 'Other', severity: 'low' },
  { key: 'other', label: 'Something else', group: 'Other', severity: 'low' },
] as const satisfies readonly { key: string; label: string; group: string; severity: Severity }[];

export type CategoryKey = (typeof CATEGORIES)[number]['key'];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as [CategoryKey, ...CategoryKey[]];
export const SEVERITIES: readonly Severity[] = ['low', 'normal', 'high', 'urgent'];
export const AGAINST_KINDS = ['teacher', 'staff', 'student', 'parent', 'principal', 'admin', 'school', 'other'] as const;
export type AgainstKind = (typeof AGAINST_KINDS)[number];
export const STATUSES = ['open', 'in_review', 'resolved', 'closed'] as const;
export type Status = (typeof STATUSES)[number];
/** Who sees a complaint: the principal, the admin, or both. */
export type HandlerScope = 'principal' | 'admin' | 'both';

const RANK: Record<Severity, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** The category's default severity; the author may raise it but never lower it below the default. */
export function severityFor(category: CategoryKey, requested?: Severity): Severity {
  const base = CATEGORIES.find((c) => c.key === category)?.severity ?? 'normal';
  return requested && RANK[requested] > RANK[base] ? requested : base;
}

/**
 * A complaint about the principal goes to the admin, and one about the admin to the principal, so
 * nobody judges a complaint against themselves. Everything else goes to both.
 */
export function scopeFor(against: AgainstKind): HandlerScope {
  if (against === 'principal') return 'admin';
  if (against === 'admin') return 'principal';
  return 'both';
}

/** The scopes a handler may read, from the roles they hold (shared admin accounts count as admin). */
export function readableScopes(roleKeys: readonly string[]): HandlerScope[] {
  const principal = roleKeys.includes('principal');
  const admin = roleKeys.some((k) => k === 'school_admin' || k.startsWith('delegate_'));
  const out = new Set<HandlerScope>();
  if (principal) { out.add('principal'); out.add('both'); }
  if (admin) { out.add('admin'); out.add('both'); }
  return [...out];
}

const ROLE_WORD: Record<string, string> = { student: 'A student', parent: 'A parent', teacher: 'A teacher', non_teaching_staff: 'A staff member', accounts: 'An accounts officer', principal: 'The principal', school_admin: 'The admin' };

/** How a handler sees an anonymous complainant: only what kind of person, never who. */
export function anonymousLabel(roleKey: string): string {
  return `${ROLE_WORD[roleKey] ?? 'Someone at the school'} (anonymous)`;
}

/** Who a complaint is addressed to: the school's management, one of them, or (staff only) parents. */
export const SEND_TO = ['management', 'principal', 'admin', 'student_parents', 'class_parents', 'teacher'] as const;
export type SendTo = (typeof SEND_TO)[number];
/** Roles that may write to parents; students, parents, accounts and support staff may not. */
export const MAY_ADDRESS_PARENTS = ['principal', 'school_admin', 'teacher'] as const;

/** Where the management copy goes: the chosen person, else by who it is about (see scopeFor). */
export function scopeForSend(sendTo: SendTo, against: AgainstKind): HandlerScope {
  if (sendTo === 'principal') return 'principal';
  if (sendTo === 'admin') return 'admin';
  return scopeFor(against);
}

export const STATUS_LABEL: Record<Status, string> = { open: 'Open', in_review: 'Under review', resolved: 'Resolved', closed: 'Closed' };

/** Moves a handler may make. Resolved and closed can be reopened (a complainant reply reopens resolved ones too). */
export function canMove(from: Status, to: Status): boolean {
  if (from === to) return false;
  if (from === 'closed') return to === 'open';
  return true;
}
