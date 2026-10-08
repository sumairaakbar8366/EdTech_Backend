/**
 * Report-card computation (page 10: Results Entered → Grading Applied → Report Card Generated).
 * Pure functions so the rules are unit-tested.
 */

export interface Band {
  grade: string;
  /** Lowest percentage for this grade (inclusive). */
  minPercent: number;
  remark: string;
}

/** Default scale (decision 16); schools can edit it. Highest band first. */
export const DEFAULT_BANDS: Band[] = [
  { grade: 'A+', minPercent: 90, remark: 'Outstanding' },
  { grade: 'A', minPercent: 80, remark: 'Excellent' },
  { grade: 'B', minPercent: 70, remark: 'Very good' },
  { grade: 'C', minPercent: 60, remark: 'Good' },
  { grade: 'D', minPercent: 50, remark: 'Satisfactory' },
  { grade: 'E', minPercent: 40, remark: 'Needs improvement' },
  { grade: 'F', minPercent: 0, remark: 'Fail' },
];

/** Bands must start at 0, be strictly descending and have unique grade labels. */
export function validateBands(bands: Band[]): string | null {
  if (bands.length < 2) return 'A grading scale needs at least two grades';
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  if (sorted.some((b, i) => i > 0 && b.minPercent === sorted[i - 1]!.minPercent)) return 'Each grade needs a different minimum percentage';
  if (sorted.at(-1)!.minPercent !== 0) return 'The lowest grade must start at 0%';
  if (sorted.some((b) => b.minPercent < 0 || b.minPercent > 100)) return 'Minimum percentages must be between 0 and 100';
  if (new Set(bands.map((b) => b.grade.trim().toUpperCase())).size !== bands.length) return 'Grade labels must be unique';
  return null;
}

export function gradeFor(percent: number, bands: Band[]): Band {
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent) ?? sorted.at(-1)!;
}

export interface PaperIn {
  subject: string;
  maxMarks: number;
  passMarks: number;
  /** null = absent or not entered. */
  marks: number | null;
  isAbsent: boolean;
}

export interface CardOut {
  totalMarks: number;
  totalMax: number;
  percentage: number;
  grade: string;
  remark: string;
  passed: boolean;
  lines: (PaperIn & { grade: string; passed: boolean })[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Totals every paper of the class (an absent or missing paper scores 0 and fails).
 * The student passes only if every paper reaches its pass mark.
 */
export function computeCard(papers: PaperIn[], bands: Band[]): CardOut {
  const lines = papers.map((p) => {
    const got = p.marks ?? 0;
    const pct = p.maxMarks > 0 ? (got / p.maxMarks) * 100 : 0;
    return { ...p, grade: p.isAbsent ? 'ABS' : gradeFor(pct, bands).grade, passed: !p.isAbsent && p.marks !== null && got >= p.passMarks };
  });
  const totalMarks = round2(lines.reduce((s, l) => s + (l.marks ?? 0), 0));
  const totalMax = round2(lines.reduce((s, l) => s + l.maxMarks, 0));
  const percentage = totalMax > 0 ? round2((totalMarks / totalMax) * 100) : 0;
  const band = gradeFor(percentage, bands);
  return { totalMarks, totalMax, percentage, grade: band.grade, remark: band.remark, passed: lines.length > 0 && lines.every((l) => l.passed), lines };
}

/** Standard competition ranking by percentage: 1, 2, 2, 4. */
export function rankByPercentage<T extends { percentage: number }>(rows: T[]): Map<T, number> {
  const sorted = [...rows].sort((a, b) => b.percentage - a.percentage);
  const ranks = new Map<T, number>();
  sorted.forEach((r, i) => ranks.set(r, i > 0 && r.percentage === sorted[i - 1]!.percentage ? ranks.get(sorted[i - 1]!)! : i + 1));
  return ranks;
}
