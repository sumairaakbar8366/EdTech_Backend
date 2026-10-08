import { describe, expect, it } from 'vitest';
import {
  MODULES,
  PERMISSION_CATALOG,
  PERMISSION_MATRIX,
  defaultPermissionsForRole,
  hasAccess,
} from './rbac.js';

describe('permission matrix (page 15)', () => {
  it('covers the 12 page-15 modules plus approved additions', () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual([...MODULES].sort());
  });

  it('catalog has unique keys that cover every non-empty matrix cell', () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const module of MODULES) {
      for (const action of Object.values(PERMISSION_MATRIX[module])) {
        if (action) expect(keys).toContain(`${module}:${action}`);
      }
    }
  });

  it('gives school admins settings CRUD and payroll approve only', () => {
    const admin = defaultPermissionsForRole('school_admin');
    expect(admin).toContain('settings:crud');
    expect(admin).toContain('payroll:approve');
    expect(admin).not.toContain('payroll:crud');
    expect(admin).toHaveLength(MODULES.length);
    expect(admin).toContain('academics:crud');
  });

  it('matches representative cells for other roles', () => {
    expect(defaultPermissionsForRole('accounts')).toEqual(
      expect.arrayContaining(['fees:crud', 'payroll:crud', 'reports:finance']),
    );
    expect(defaultPermissionsForRole('accounts')).not.toContain(expect.stringMatching(/^settings:/));
    expect(defaultPermissionsForRole('teacher')).toEqual(
      expect.arrayContaining(['attendance:mark', 'results:enter', 'staff:own']),
    );
    expect(defaultPermissionsForRole('student')).toContain('assignments:submit');
    expect(defaultPermissionsForRole('parent')).toContain('students:children');
    expect(defaultPermissionsForRole('parent').some((k) => k.startsWith('staff:'))).toBe(false);
    expect(defaultPermissionsForRole('teacher')).toContain('academics:view');
    expect(defaultPermissionsForRole('parent')).toContain('academics:children');
  });

  it('gives non-teaching staff only their own records (approved 2026-10-01)', () => {
    expect(defaultPermissionsForRole('non_teaching_staff').sort()).toEqual(
      ['attendance:own', 'communication:own', 'documents:own', 'leave:own', 'payroll:own', 'staff:own'].sort(),
    );
  });

  it('applies the approved rows for the remaining modules', () => {
    expect(defaultPermissionsForRole('school_admin')).toEqual(expect.arrayContaining(['leave:approve', 'audit:view', 'exams:crud']));
    expect(defaultPermissionsForRole('accounts')).toContain('leave:view');
    expect(defaultPermissionsForRole('parent')).toEqual(expect.arrayContaining(['documents:children', 'communication:own']));
    expect(defaultPermissionsForRole('student').some((k) => k.startsWith('audit:'))).toBe(false);
  });
});

describe('hasAccess', () => {
  const granted = ['fees:crud', 'students:view'];

  it('accepts when any accepted level is granted', () => {
    expect(hasAccess(granted, 'fees', ['crud'])).toBe(true);
    expect(hasAccess(granted, 'students', ['crud', 'view'])).toBe(true);
  });

  it('rejects when the level is not granted', () => {
    expect(hasAccess(granted, 'students', ['crud'])).toBe(false);
    expect(hasAccess(granted, 'settings', ['crud', 'view'])).toBe(false);
  });
});
