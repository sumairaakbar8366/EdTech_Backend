/** Wall-clock "now" in a school's timezone: calendar date, ISO weekday and minute of day. */
export interface SchoolClock {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 1 = Monday ... 7 = Sunday
  minute: number; // minutes after midnight
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function schoolClock(timeZone: string, at: Date = new Date()): SchoolClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAYS[parts.weekday!]!,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** ISO weekday (1 = Monday) of a YYYY-MM-DD calendar date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** "08:30" <-> 510 */
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
