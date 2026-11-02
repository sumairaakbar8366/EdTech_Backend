/**
 * The scholarship shortlist: "excellent in studies" (results and attendance) and "needs support"
 * (signals from the school's own fee records), worked out from data the school already keeps.
 * Pure functions, so the rules can be read and tested on their own. A shortlist only suggests: the
 * school confirms need before any name leaves it.
 */
export interface StudentFacts {
  /** Average percentage over published exams; null when none. */
  average: number | null;
  /** Percent of marked days present or late over the last year; null when none marked. */
  attendance: number | null;
  hasConcession: boolean;
  overdueInvoices: number;
  /** Fees still owed, in the school's currency. */
  outstanding: number;
}

export interface Rules {
  minAverage: number;
  minAttendance: number;
  needRequired: boolean;
}

export interface Scored {
  meritScore: number;
  needScore: number;
  rankScore: number;
  eligible: boolean;
  /** Top results and attendance: worth awarding on merit alone. */
  excellent: boolean;
  reasons: string[];
  /** Why the student is not on the list. */
  blockers: string[];
}

/** Smallest need score that counts as "some sign of need" when the program requires need. */
export const MIN_NEED = 15;

export function score(f: StudentFacts, rules: Rules): Scored {
  const avg = f.average ?? 0;
  const att = f.attendance ?? 0;
  const meritScore = Math.round(avg * 0.7 + att * 0.3);
  let needScore = 0;
  const reasons: string[] = [];
  if (f.average !== null) reasons.push(`Average ${Math.round(f.average)}% in published exams`);
  if (f.attendance !== null) reasons.push(`Attendance ${Math.round(f.attendance)}%`);
  if (f.hasConcession) { needScore += 40; reasons.push('Already receives a fee concession or scholarship'); }
  if (f.overdueInvoices > 0) { needScore += Math.min(30, 15 * f.overdueInvoices); reasons.push(`${f.overdueInvoices} overdue fee invoice${f.overdueInvoices === 1 ? '' : 's'}`); }
  if (f.outstanding > 0) { needScore += 15; reasons.push('Fees outstanding'); }
  needScore = Math.min(100, needScore);

  const blockers: string[] = [];
  if (f.average === null) blockers.push('No published exam results yet');
  else if (f.average < rules.minAverage) blockers.push(`Average ${Math.round(f.average)}% is below ${rules.minAverage}%`);
  if (f.attendance === null) blockers.push('No attendance recorded');
  else if (f.attendance < rules.minAttendance) blockers.push(`Attendance ${Math.round(f.attendance)}% is below ${rules.minAttendance}%`);
  if (rules.needRequired && needScore < MIN_NEED) blockers.push('No sign of financial need in the school’s records');

  return {
    meritScore, needScore, rankScore: Math.round(meritScore * 0.6 + needScore * 0.4),
    eligible: blockers.length === 0, excellent: f.average !== null && f.attendance !== null && f.average >= 90 && f.attendance >= 90, reasons, blockers,
  };
}

/** The cycle a program is working on: the one the owner set, else the year. */
export const periodLabel = (current: string | null | undefined, year: number) => current?.trim() || String(year);
