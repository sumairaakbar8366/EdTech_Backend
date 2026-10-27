import type { AccessLevel, Module } from '@schoolerp/shared';

/** Role keys of shared admin accounts: "delegate_2" is shown as "Admin 2". */
export const DELEGATE_PREFIX = 'delegate_';
export const isDelegateRole = (key: string) => key.startsWith(DELEGATE_PREFIX);

/**
 * What an admin may share, per area, and at which levels (the first is read-only). School settings,
 * billing, Users & Access and the activity logs are never shareable, so a shared admin cannot see
 * private records of the school or hand access on.
 */
export const SHAREABLE_ACCESS: Partial<Record<Module, readonly AccessLevel[]>> = {
  communication: ['view', 'crud'],
  students: ['view', 'crud'],
  staff: ['view', 'crud'],
  admissions: ['view', 'crud'],
  academics: ['view', 'crud'],
  attendance: ['view', 'crud'],
  timetable: ['view', 'crud'],
  leave: ['view', 'approve'],
  fees: ['view', 'crud'],
  exams: ['view', 'crud'],
  results: ['view', 'crud'],
  lms: ['view', 'crud'],
  documents: ['view', 'crud'],
  reports: ['all'],
};
