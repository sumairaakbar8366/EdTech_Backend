import type { SchoolRoleKey } from './roles.js';

// Role-based dashboard navigation. Source: architecture board, page 4 (Dashboard Architecture).
// Page 4 has no non-teaching staff dashboard, so that menu is built from the role's
// page-3 capabilities (own attendance, leave requests, assigned tasks, payslip).

export interface NavItem {
  label: string;
  /** App route, relative to the tenant root. */
  path: string;
}

function toPath(label: string): string {
  if (label === 'Dashboard') return '/';
  return (
    '/' +
    label
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

function items(labels: string[]): NavItem[] {
  return labels.map((label) => ({ label, path: toPath(label) }));
}

export const ROLE_NAVIGATION: Record<SchoolRoleKey, readonly NavItem[]> = {
  principal: items([
    'Dashboard', 'Activity', 'Students', 'Staff', 'Admissions', 'Attendance', 'Timetable', 'Exams & Results',
    'Finance', 'Payroll', 'Communication', 'Reports', 'Documents',
  ]),
  school_admin: items([
    'Dashboard', 'Students', 'Staff', 'Admissions', 'Academics', 'Attendance', 'Timetable',
    'Finance', 'Payroll', 'LMS', 'Exams & Results', 'Communication', 'Reports', 'Documents', 'Website', 'Users & Access', 'Activity', 'Plans & Billing', 'Settings',
  ]),
  accounts: items([
    'Dashboard', 'Fee Structures', 'Student Invoices', 'Payments', 'Pending Fees', 'Overdue Fees',
    'Discounts', 'Scholarships', 'Staff Payroll', 'Salary Processing', 'Payslips', 'Financial Reports',
  ]),
  teacher: items([
    'Dashboard', 'My Timetable', "Today's Classes", 'Start Class', 'Class Attendance', 'My Students',
    'Assignments', 'Learning Material', 'Exams / Marks', 'Student Performance', 'My Attendance',
    'Leave', 'Salary / Payslips', 'Profile',
  ]),
  non_teaching_staff: items(['Dashboard', 'My Attendance', 'Leave', 'Assigned Tasks', 'Payslips']),
  student: items([
    'Dashboard', 'My Profile', 'My Classes', 'Timetable', 'Attendance', 'Learning Material',
    'Assignments', 'Exams', 'Results', 'Fees', 'Documents', 'Document Requests', 'Notifications',
  ]),
  parent: items([
    'Dashboard', 'My Children', 'Attendance', 'Timetable', 'Homework', 'Results', 'Fees',
    'Receipts', 'Notifications', 'Teacher Communication', 'Documents', 'Document Requests',
  ]),
};

/**
 * Navigation for a user holding one or more roles: items are merged in role order
 * and de-duplicated by path, so a teacher who is also a parent sees both sets once.
 */
export function navigationForRoles(roles: readonly SchoolRoleKey[]): NavItem[] {
  const result: NavItem[] = [];
  const seen = new Set<string>();
  for (const role of roles) {
    for (const item of ROLE_NAVIGATION[role] ?? []) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      result.push(item);
    }
  }
  return result;
}

export const PLATFORM_NAVIGATION: readonly NavItem[] = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Schools', path: '/schools' },
  { label: 'Applications', path: '/applications' },
  { label: 'Payments', path: '/payments' },
  { label: 'Subscription Plans', path: '/tiers' },
  { label: 'System', path: '/system' },
];
