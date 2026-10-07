/** Display helpers. Every date/time is shown in the SHOP's time zone, never the browser's. */

const LOCALE = "en-GB";

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatTime(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instant));
}

export function formatLongDate(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(instant));
}

/**
 * Formats a shop-local calendar date ("YYYY-MM-DD"). Noon UTC keeps the
 * date the same in every time zone, so it is safe to format in UTC.
 */
export function formatCalendarDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
): string {
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
