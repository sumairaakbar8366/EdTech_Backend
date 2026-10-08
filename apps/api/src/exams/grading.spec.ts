import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS, computeCard, gradeFor, rankByPercentage, validateBands } from './grading.js';

describe('gradeFor', () => {
  it('picks the highest band reached', () => {
    expect(gradeFor(95, DEFAULT_BANDS).grade).toBe('A+');
    expect(gradeFor(90, DEFAULT_BANDS).grade).toBe('A+');
    expect(gradeFor(89.99, DEFAULT_BANDS).grade).toBe('A');
    expect(gradeFor(39.5, DEFAULT_BANDS).grade).toBe('F');
  });
});

describe('validateBands', () => {
  it('accepts the default scale', () => expect(validateBands(DEFAULT_BANDS)).toBeNull());
  it('requires a band starting at 0', () => expect(validateBands([{ grade: 'P', minPercent: 50, remark: '' }, { grade: 'X', minPercent: 60, remark: '' }])).toMatch(/0%/));
  it('rejects duplicate thresholds and labels', () => {
    expect(validateBands([{ grade: 'A', minPercent: 50, remark: '' }, { grade: 'B', minPercent: 50, remark: '' }, { grade: 'F', minPercent: 0, remark: '' }])).toMatch(/different/);
    expect(validateBands([{ grade: 'A', minPercent: 50, remark: '' }, { grade: 'a', minPercent: 0, remark: '' }])).toMatch(/unique/);
  });
});

describe('computeCard', () => {
  const papers = [
    { subject: 'Maths', maxMarks: 100, passMarks: 33, marks: 88, isAbsent: false },
    { subject: 'English', maxMarks: 100, passMarks: 33, marks: 72, isAbsent: false },
    { subject: 'Urdu', maxMarks: 50, passMarks: 17, marks: 40, isAbsent: false },
  ];

  it('totals, grades and passes', () => {
    const c = computeCard(papers, DEFAULT_BANDS);
    expect(c.totalMarks).toBe(200);
    expect(c.totalMax).toBe(250);
    expect(c.percentage).toBe(80);
    expect(c.grade).toBe('A');
    expect(c.passed).toBe(true);
    expect(c.lines.map((l) => l.grade)).toEqual(['A', 'B', 'A']);
  });

  it('fails a student below the pass mark in any paper', () => {
    const c = computeCard([...papers.slice(0, 2), { subject: 'Urdu', maxMarks: 50, passMarks: 17, marks: 12, isAbsent: false }], DEFAULT_BANDS);
    expect(c.passed).toBe(false);
    expect(c.lines[2]!.passed).toBe(false);
  });

  it('counts an absent paper as zero and a fail', () => {
    const c = computeCard([papers[0]!, { subject: 'English', maxMarks: 100, passMarks: 33, marks: null, isAbsent: true }], DEFAULT_BANDS);
    expect(c.totalMarks).toBe(88);
    expect(c.percentage).toBe(44);
    expect(c.lines[1]!.grade).toBe('ABS');
    expect(c.passed).toBe(false);
  });
});

describe('rankByPercentage', () => {
  it('uses competition ranking for ties', () => {
    const rows = [{ percentage: 70 }, { percentage: 90 }, { percentage: 70 }, { percentage: 50 }];
    const r = rankByPercentage(rows);
    expect(rows.map((x) => r.get(x))).toEqual([2, 1, 2, 4]);
  });
});
