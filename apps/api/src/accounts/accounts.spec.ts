import { describe, expect, it } from 'vitest';
import { formatLoginId, LOGIN_PREFIX, normaliseLoginId, temporaryPassword } from './accounts.service.js';

describe('User IDs', () => {
  it('formats prefix-year-number with at least four digits', () => {
    expect(formatLoginId('TCH', 2026, 7)).toBe('TCH-2026-0007');
    expect(formatLoginId('STU', 2025, 12345)).toBe('STU-2025-12345');
  });

  it('normalises what people type', () => {
    expect(normaliseLoginId('  tch-2026-0007 ')).toBe('TCH-2026-0007');
    expect(normaliseLoginId('par - 2026 - 0098')).toBe('PAR-2026-0098');
  });

  it('has a distinct prefix for every role', () => {
    expect(new Set(Object.values(LOGIN_PREFIX)).size).toBe(Object.keys(LOGIN_PREFIX).length);
  });
});

describe('temporaryPassword', () => {
  it('is 14 characters in three groups without look-alike characters', () => {
    const p = temporaryPassword();
    expect(p).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(p).not.toMatch(/[01OIl]/);
  });
});
