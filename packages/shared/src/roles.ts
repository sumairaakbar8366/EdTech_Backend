// School-level roles. Source: architecture board, page 3 (User Roles & Permissions).
// Every school is provisioned with these as system roles. `level` orders authority
// (lower = more authority) and is stored in roles.level as the blueprint ERD specifies.

export const SCHOOL_ROLE_KEYS = [
  'principal',
  'school_admin',
  'accounts',
  'teacher',
  'non_teaching_staff',
  'student',
  'parent',
] as const;

export type SchoolRoleKey = (typeof SCHOOL_ROLE_KEYS)[number];

export interface SchoolRoleDefinition {
  key: SchoolRoleKey;
  name: string;
  level: number;
  description: string;
}

export const SCHOOL_ROLES: readonly SchoolRoleDefinition[] = [
  { key: 'principal', name: 'Principal', level: 0, description: 'Oversees the whole school: sees every activity, approves, basic edits' },
  { key: 'school_admin', name: 'School Admin', level: 1, description: 'Full school management authority' },
  { key: 'accounts', name: 'Accounts', level: 2, description: 'Financial operations' },
  { key: 'teacher', name: 'Teacher', level: 3, description: 'Classroom & academic operations' },
  { key: 'non_teaching_staff', name: 'Non-Teaching Staff', level: 3, description: 'Support operations' },
  { key: 'student', name: 'Student', level: 4, description: 'Academic access' },
  { key: 'parent', name: 'Parent', level: 4, description: 'Child monitoring' },
];

export function isSchoolRoleKey(value: string): value is SchoolRoleKey {
  return (SCHOOL_ROLE_KEYS as readonly string[]).includes(value);
}
