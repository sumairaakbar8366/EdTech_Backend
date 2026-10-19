import type { SchoolRoleKey } from './roles.js';

// Role-based access control. Source: architecture board, page 15 (Permission Matrix).
//
// The blueprint's `permissions` table stores (module, action). Here the action is
// the matrix access level, so each matrix cell maps to exactly one permission row.
// A "No" cell means no permission row.

export const MODULES = [
  'students',
  'staff',
  'admissions',
  'academics',
  'attendance',
  'fees',
  'payroll',
  'assignments',
  'results',
  'reports',
  'lms',
  'timetable',
  'settings',
  'exams',
  'leave',
  'communication',
  'documents',
  'audit',
] as const;

export type Module = (typeof MODULES)[number];

export const ACCESS_LEVELS = [
  'crud', // Full create, read, update, delete
  'all', // All reports
  'approve', // Approval action only
  'finance', // Finance reports only
  'view', // Read-only access
  'mark', // Specific write action (attendance)
  'enter', // Specific write action (results)
  'submit', // Student submissions only
  'own', // Own record only
  'children', // Own children only
] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const ACCESS_LEVEL_DESCRIPTIONS: Record<AccessLevel, string> = {
  crud: 'Full create, read, update, delete',
  all: 'Access to all records in the module',
  approve: 'Approval action only',
  finance: 'Financial records only',
  view: 'Read-only access',
  mark: 'Specific write action: mark',
  enter: 'Specific write action: enter',
  submit: 'Student submissions only',
  own: 'Own record only',
  children: 'Own children only',
};

/** Every school role has a column (non-teaching staff added with approval, 2026-10-01). */
export type MatrixRole = SchoolRoleKey;

type MatrixRow = Record<MatrixRole, AccessLevel | null>;

/**
 * Page 15, cell for cell, plus approved additions. `null` = "No".
 * Approved 2026-10-01: the academics, exams, leave, communication, documents and audit rows,
 * and the non-teaching staff column (own staff record, own attendance, own payroll, own leave,
 * own communication and own documents).
 * Approved 2026-10-19: the principal column (oversees everything, approvals with the admin, basic
 * edits; school settings, billing and Users & Access stay with the School Admin).
 */
// prettier-ignore
export const PERMISSION_MATRIX: Record<Module, MatrixRow> = {
  //             principal              school_admin        accounts             teacher            non_teaching_staff          student             parent
  students:      { principal: 'crud',    school_admin: 'crud',    accounts: 'view',    teacher: 'view',  non_teaching_staff: null,   student: 'own',    parent: 'children' },
  staff:         { principal: 'crud',    school_admin: 'crud',    accounts: 'view',    teacher: 'own',   non_teaching_staff: 'own',  student: null,     parent: null },
  admissions:    { principal: 'crud',    school_admin: 'crud',    accounts: 'view',    teacher: null,    non_teaching_staff: null,   student: 'own',    parent: 'own' },
  academics:     { principal: 'crud',    school_admin: 'crud',    accounts: 'view',    teacher: 'view',  non_teaching_staff: null,   student: 'own',    parent: 'children' },
  attendance:    { principal: 'crud',    school_admin: 'crud',    accounts: 'view',    teacher: 'mark',  non_teaching_staff: 'own',  student: 'own',    parent: 'children' },
  fees:          { principal: 'view',    school_admin: 'crud',    accounts: 'crud',    teacher: 'view',  non_teaching_staff: null,   student: 'own',    parent: 'children' },
  payroll:       { principal: 'approve', school_admin: 'approve', accounts: 'crud',    teacher: 'own',   non_teaching_staff: 'own',  student: null,     parent: null },
  assignments:   { principal: 'view',    school_admin: 'crud',    accounts: null,      teacher: 'crud',  non_teaching_staff: null,   student: 'submit', parent: 'view' },
  results:       { principal: 'crud',    school_admin: 'crud',    accounts: null,      teacher: 'enter', non_teaching_staff: null,   student: 'view',   parent: 'view' },
  reports:       { principal: 'all',     school_admin: 'all',     accounts: 'finance', teacher: 'own',   non_teaching_staff: null,   student: 'own',    parent: 'children' },
  lms:           { principal: 'view',    school_admin: 'crud',    accounts: null,      teacher: 'crud',  non_teaching_staff: null,   student: 'view',   parent: 'view' },
  timetable:     { principal: 'crud',    school_admin: 'crud',    accounts: 'view',    teacher: 'view',  non_teaching_staff: null,   student: 'view',   parent: 'view' },
  settings:      { principal: null,      school_admin: 'crud',    accounts: null,      teacher: null,    non_teaching_staff: null,   student: null,     parent: null },
  exams:         { principal: 'crud',    school_admin: 'crud',    accounts: null,      teacher: 'view',  non_teaching_staff: null,   student: 'view',   parent: 'view' },
  leave:         { principal: 'approve', school_admin: 'approve', accounts: 'view',    teacher: 'own',   non_teaching_staff: 'own',  student: null,     parent: null },
  communication: { principal: 'crud',    school_admin: 'crud',    accounts: 'view',    teacher: 'own',   non_teaching_staff: 'own',  student: 'view',   parent: 'own' },
  documents:     { principal: 'crud',    school_admin: 'crud',    accounts: 'view',    teacher: 'own',   non_teaching_staff: 'own',  student: 'own',    parent: 'children' },
  audit:         { principal: 'view',    school_admin: 'view',    accounts: null,      teacher: null,    non_teaching_staff: null,   student: null,     parent: null },
};

/** A permission as stored: "module:action", e.g. "fees:crud". */
export type PermissionKey = `${Module}:${AccessLevel}`;

export function permissionKey(module: Module, action: AccessLevel): PermissionKey {
  return `${module}:${action}`;
}

export interface PermissionDefinition {
  module: Module;
  action: AccessLevel;
  key: PermissionKey;
  description: string;
}

/** The permission catalog: every distinct (module, action) used by the matrix. */
export const PERMISSION_CATALOG: readonly PermissionDefinition[] = (() => {
  const seen = new Map<PermissionKey, PermissionDefinition>();
  for (const module of MODULES) {
    for (const action of Object.values(PERMISSION_MATRIX[module])) {
      if (action === null) continue;
      const key = permissionKey(module, action);
      if (!seen.has(key)) {
        seen.set(key, { module, action, key, description: ACCESS_LEVEL_DESCRIPTIONS[action] });
      }
    }
  }
  return [...seen.values()];
})();

/** Default permissions for each system role, straight from the matrix. */
export function defaultPermissionsForRole(role: SchoolRoleKey): PermissionKey[] {
  const keys: PermissionKey[] = [];
  for (const module of MODULES) {
    const action = PERMISSION_MATRIX[module][role];
    if (action !== null) keys.push(permissionKey(module, action));
  }
  return keys;
}

/** True when the granted permissions include at least one of the accepted levels for the module. */
export function hasAccess(
  granted: Iterable<string>,
  module: Module,
  accepted: readonly AccessLevel[],
): boolean {
  const set = granted instanceof Set ? (granted as Set<string>) : new Set(granted);
  return accepted.some((action) => set.has(permissionKey(module, action)));
}
