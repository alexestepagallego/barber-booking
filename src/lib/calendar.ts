/**
 * Calendar-date helpers for shop-local dates written as "YYYY-MM-DD".
 * They do plain date arithmetic in UTC, so they never depend on the time
 * zone of the machine running them (server or browser).
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(date: string): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`Invalid date "${date}", expected YYYY-MM-DD`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Reject impossible dates such as 2026-02-30, which Date would silently roll over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError(`Invalid date "${date}"`);
  }
  return { year, month, day };
}

/** Adds whole calendar days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const { year, month, day } = parseDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
