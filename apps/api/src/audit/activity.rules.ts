import type { Prisma } from '../generated/prisma/client.js';

/** critical = shown red (could do harm or undo records), warning = sensitive, info = sign-ins. */
export type ActivityLevel = 'critical' | 'warning' | 'info';

interface Rule {
  level: Exclude<ActivityLevel, 'info'>;
  label: string;
  entity?: string;
  actions?: string[];
  method?: string;
  pathIncludes?: string;
}

/**
 * The audit-log writes worth an administrator's attention, first match wins. Routine work (attendance,
 * lessons, messages, timetable edits) is left out so the activity monitor only shows what could hurt:
 * deletions, access changes, results and money.
 */
const RULES: Rule[] = [
  { level: 'critical', label: 'Deleted a record', method: 'DELETE' },
  { level: 'critical', label: 'Reset a password', entity: 'users', actions: ['reset-password'] },
  { level: 'critical', label: "Changed an account's access", entity: 'users', actions: ['status'] },
  { level: 'critical', label: "Changed a user's roles", entity: 'users', pathIncludes: '/roles' },
  { level: 'critical', label: 'Changed a login email', entity: 'users', pathIncludes: '/email' },
  { level: 'critical', label: 'Corrected a report card', entity: 'exams', actions: ['corrections'] },
  { level: 'critical', label: 'Voided a fee payment', entity: 'fees', actions: ['void'] },
  { level: 'critical', label: 'Waived or cancelled an invoice', entity: 'fees', actions: ['waive', 'cancel'] },
  { level: 'critical', label: 'Revoked a scholarship', entity: 'fees', actions: ['revoke'] },
  { level: 'critical', label: "Changed the school's domain", entity: 'settings', pathIncludes: '/domains' },
  { level: 'warning', label: 'Entered or changed marks', entity: 'exams', pathIncludes: '/marksheet' },
  { level: 'warning', label: 'Published results', entity: 'exams', actions: ['publish'] },
  { level: 'warning', label: 'Generated report cards (pass / fail)', entity: 'exams', actions: ['report-cards'] },
  { level: 'warning', label: 'Recorded a fee payment', entity: 'fees', actions: ['create'], pathIncludes: '/payments' },
  { level: 'warning', label: 'Gave a fee concession', entity: 'fees', pathIncludes: '/concessions' },
  { level: 'warning', label: 'Awarded a scholarship', entity: 'fees', actions: ['create'], pathIncludes: '/awards' },
  { level: 'warning', label: 'Approved payroll', entity: 'payroll', actions: ['approve'] },
  { level: 'warning', label: 'Paid payroll', entity: 'payroll', actions: ['pay'] },
  { level: 'warning', label: 'Changed a salary', entity: 'payroll', pathIncludes: '/structures' },
  { level: 'warning', label: 'Bank account change', entity: 'payroll', pathIncludes: '/bank-accounts' },
  { level: 'warning', label: 'Created a login', entity: 'users', actions: ['create'] },
  { level: 'warning', label: 'Created a student login', entity: 'students', actions: ['login'] },
  { level: 'warning', label: 'Changed school settings', entity: 'settings' },
  { level: 'warning', label: 'Plan or billing change', entity: 'billing' },
];

function ruleWhere(r: Rule): Prisma.AuditLogWhereInput {
  return {
    ...(r.entity && { entity: r.entity }),
    ...(r.actions && { action: { in: r.actions } }),
    ...(r.method && { method: r.method }),
    ...(r.pathIncludes && { path: { contains: r.pathIncludes } }),
  };
}

/** Prisma filter for the sensitive audit rows, optionally only those of one level. */
export function sensitiveWhere(level?: ActivityLevel): Prisma.AuditLogWhereInput {
  const rules = RULES.filter((r) => !level || r.level === level);
  // A critical rule also matches rows a later warning rule would; keep warning-only views exact.
  if (level === 'warning') return { AND: [{ OR: rules.map(ruleWhere) }, { NOT: { OR: RULES.filter((r) => r.level === 'critical').map(ruleWhere) } }] };
  return rules.length ? { OR: rules.map(ruleWhere) } : { id: { equals: '00000000-0000-0000-0000-000000000000' } };
}

export function classify(row: { entity: string; action: string; method: string; path: string }): { level: ActivityLevel; label: string } {
  const r = RULES.find((x) =>
    (!x.entity || x.entity === row.entity) &&
    (!x.actions || x.actions.includes(row.action)) &&
    (!x.method || x.method === row.method) &&
    (!x.pathIncludes || row.path.includes(x.pathIncludes)),
  );
  if (!r) return { level: 'warning', label: `${row.action} ${row.entity}` };
  return { level: r.level, label: r.method === 'DELETE' ? `Deleted ${row.entity.replace(/-/g, ' ')} record` : r.label };
}
