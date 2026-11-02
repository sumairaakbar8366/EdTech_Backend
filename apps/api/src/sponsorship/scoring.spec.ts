import { describe, expect, it } from 'vitest';
import { score, periodLabel, type StudentFacts } from './scoring.js';

const rules = { minAverage: 70, minAttendance: 85, needRequired: true };
const facts = (o: Partial<StudentFacts> = {}): StudentFacts => ({ average: 92, attendance: 96, hasConcession: false, overdueInvoices: 2, outstanding: 5000, ...o });

describe('scholarship shortlist scoring', () => {
  it('lists a strong student with signs of need and says why', () => {
    const s = score(facts(), rules);
    expect(s.eligible).toBe(true);
    expect(s.excellent).toBe(true);
    expect(s.needScore).toBe(45);
    expect(s.reasons.join(' ')).toMatch(/Average 92%.*Attendance 96%.*2 overdue.*outstanding/s);
  });
  it('does not list a student who can pay, when need is required', () => {
    const s = score(facts({ overdueInvoices: 0, outstanding: 0 }), rules);
    expect(s.eligible).toBe(false);
    expect(s.blockers).toContain('No sign of financial need in the school’s records');
    expect(score(facts({ overdueInvoices: 0, outstanding: 0 }), { ...rules, needRequired: false }).eligible).toBe(true);
  });
  it('needs good results and attendance', () => {
    expect(score(facts({ average: 60 }), rules).blockers[0]).toMatch(/below 70%/);
    expect(score(facts({ attendance: 70 }), rules).eligible).toBe(false);
    expect(score(facts({ average: null }), rules).blockers).toContain('No published exam results yet');
    expect(score(facts({ attendance: null }), rules).blockers).toContain('No attendance recorded');
  });
  it('ranks need and merit together, and an existing concession counts as need', () => {
    const rich = score(facts({ average: 95, attendance: 98, overdueInvoices: 0, outstanding: 0, hasConcession: false }), { ...rules, needRequired: false });
    const poor = score(facts({ average: 85, attendance: 90, hasConcession: true, overdueInvoices: 2 }), rules);
    expect(poor.needScore).toBe(85);
    expect(poor.rankScore).toBeGreaterThan(rich.rankScore);
  });
  it('names the cycle', () => {
    expect(periodLabel(null, 2026)).toBe('2026');
    expect(periodLabel(' 2026 · Semester 1 ', 2026)).toBe('2026 · Semester 1');
  });
});
