// Synthetic calendar: every year is exactly 365 days (no leap years), so the
// season cycle stays aligned forever. Day 0 = July 1 of startYear.

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const YEAR_LENGTH = 365;
/** Day-of-year (Jan 1 = 0) for July 1. */
const JULY1 = MONTH_LENGTHS.slice(0, 6).reduce((a, b) => a + b, 0); // 181

export interface CalendarDate {
  year: number;
  month: number; // 0-11
  dayOfMonth: number; // 1-31
}

export function dayToDate(day: number, startYear: number): CalendarDate {
  const abs = day + JULY1; // days since Jan 1 of startYear
  const year = startYear + Math.floor(abs / YEAR_LENGTH);
  let rem = abs % YEAR_LENGTH;
  let month = 0;
  while (rem >= MONTH_LENGTHS[month]) {
    rem -= MONTH_LENGTHS[month];
    month++;
  }
  return { year, month, dayOfMonth: rem + 1 };
}

export function formatDay(day: number, startYear: number): string {
  const d = dayToDate(day, startYear);
  return `${d.dayOfMonth} ${MONTH_NAMES[d.month]} ${d.year}`;
}

/** Day within the current season-year (0 = Jul 1). */
export function dayOfSeasonYear(day: number): number {
  return ((day % YEAR_LENGTH) + YEAR_LENGTH) % YEAR_LENGTH;
}

// Transfer windows: summer = Jul 1 .. Aug 31 (days 0-61 of season year),
// winter = Jan 1 .. Jan 31 (days 184-214).
export function isTransferWindowOpen(day: number): boolean {
  const d = dayOfSeasonYear(day);
  return (d >= 0 && d <= 61) || (d >= 184 && d <= 214);
}

export function windowName(day: number): 'summer' | 'winter' | null {
  const d = dayOfSeasonYear(day);
  if (d >= 0 && d <= 61) return 'summer';
  if (d >= 184 && d <= 214) return 'winter';
  return null;
}

/** First round of league fixtures kicks off Aug 15 (season-year day 45). */
export const SEASON_FIRST_MATCH_DAY = 45;
/** Matches are weekly. */
export const ROUND_INTERVAL = 7;
