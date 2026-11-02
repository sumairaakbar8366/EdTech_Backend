import { describe, expect, it } from 'vitest';
import { CATEGORIES, anonymousLabel, canMove, readableScopes, scopeFor, severityFor } from './complaints.rules.js';

describe('complaint routing', () => {
  it('sends a complaint about the principal to the admin and about the admin to the principal', () => {
    expect(scopeFor('principal')).toBe('admin');
    expect(scopeFor('admin')).toBe('principal');
    for (const k of ['teacher', 'student', 'staff', 'parent', 'school', 'other'] as const) expect(scopeFor(k)).toBe('both');
  });
  it('lets each handler read only their scopes', () => {
    expect(readableScopes(['principal']).sort()).toEqual(['both', 'principal']);
    expect(readableScopes(['school_admin']).sort()).toEqual(['admin', 'both']);
    expect(readableScopes(['delegate_1']).sort()).toEqual(['admin', 'both']);
    expect(readableScopes(['principal', 'school_admin']).sort()).toEqual(['admin', 'both', 'principal']);
    expect(readableScopes(['teacher', 'parent'])).toEqual([]);
  });
});

describe('severity and statuses', () => {
  it('harassment is urgent by default and cannot be lowered', () => {
    expect(severityFor('harassment')).toBe('urgent');
    expect(severityFor('harassment', 'low')).toBe('urgent');
    expect(severityFor('canteen')).toBe('low');
    expect(severityFor('canteen', 'high')).toBe('high');
  });
  it('every category has a label, a group and a severity', () => {
    expect(new Set(CATEGORIES.map((c) => c.key)).size).toBe(CATEGORIES.length);
    for (const c of CATEGORIES) expect(c.label && c.group && c.severity).toBeTruthy();
  });
  it('closed complaints can only be reopened', () => {
    expect(canMove('closed', 'resolved')).toBe(false);
    expect(canMove('closed', 'open')).toBe(true);
    expect(canMove('open', 'resolved')).toBe(true);
    expect(canMove('open', 'open')).toBe(false);
  });
  it('an anonymous complainant is described by kind, never by name', () => {
    expect(anonymousLabel('student')).toBe('A student (anonymous)');
    expect(anonymousLabel('weird')).toContain('anonymous');
  });
});
