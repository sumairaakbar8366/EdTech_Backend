// Leadership seats: the principal, and (on plans with `leadership_roles`) a director, vice principal and
// other senior roles. Every seat works in the principal's area with the principal's powers; the school
// admin chooses the title and which parts of the principal's dashboard that person sees.

export const DASHBOARD_SECTIONS = [
  { key: 'kpis', label: 'Headline figures' },
  { key: 'live_classes', label: 'Live classes' },
  { key: 'administration', label: 'Administration staff' },
  { key: 'activity', label: 'Recent activity' },
  { key: 'leave', label: 'Leave approvals' },
  { key: 'growth', label: 'Growth report' },
  { key: 'complaints', label: 'Complaints' },
  { key: 'admissions', label: 'Admissions' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'people', label: 'People' },
  { key: 'fees', label: 'Fees' },
  { key: 'structure', label: 'School structure' },
] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number]['key'];
export const DASHBOARD_SECTION_KEYS = DASHBOARD_SECTIONS.map((s) => s.key) as readonly DashboardSection[];

export interface LeadershipTitle {
  key: string;
  label: string;
  /** What the dashboard hides by default for this title (the admin can change it). */
  hidden: readonly DashboardSection[];
  blurb: string;
}

export const LEADERSHIP_TITLES: readonly LeadershipTitle[] = [
  { key: 'principal', label: 'Principal', hidden: [], blurb: 'The whole school from above. Included in every plan.' },
  { key: 'director', label: 'Director', hidden: ['live_classes', 'administration'], blurb: 'Oversight of results, fees and growth.' },
  { key: 'vice_principal', label: 'Vice Principal', hidden: ['payroll', 'fees'], blurb: 'Runs the school day with the principal.' },
  { key: 'headmaster', label: 'Headmaster / Headmistress', hidden: ['payroll'], blurb: 'Head of a section or branch.' },
  { key: 'coordinator', label: 'Academic Coordinator', hidden: ['payroll', 'fees', 'admissions', 'administration'], blurb: 'Classes, timetable and results.' },
  { key: 'chairman', label: 'Chairman / Trustee', hidden: ['live_classes', 'leave', 'administration'], blurb: 'Board-level view: growth, fees and complaints.' },
  { key: 'controller', label: 'Controller of Examinations', hidden: ['payroll', 'fees', 'admissions', 'leave', 'growth', 'complaints', 'administration', 'kpis'], blurb: 'Exams and school structure.' },
  { key: 'custom', label: 'Other title', hidden: ['payroll'], blurb: 'Any other senior role: you name it.' },
] as const;

export const isLeadershipTitle = (key: string) => LEADERSHIP_TITLES.some((t) => t.key === key);
