/**
 * Minimal iCalendar (RFC 5545) generator for appointment invites.
 *
 * Pure and dependency-free, so the same code builds the attachment of the
 * confirmation email (server) and the "Add to calendar" download (browser).
 *
 * - UID is stable per appointment, so calendar apps update the same event
 *   when it is rescheduled (higher SEQUENCE) or cancelled (METHOD:CANCEL).
 * - Times are written in UTC ("Z"), which every client converts to the
 *   viewer's zone. No VTIMEZONE block is needed.
 * - Text is escaped and long lines are folded at 75 octets without splitting
 *   multi-byte UTF-8 characters, as the RFC requires.
 */

export type CalendarEvent = {
  uid: string;
  /** Increase on every change so clients replace the previous version. */
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizer?: { name: string; email: string };
  status: "confirmed" | "cancelled";
};

const CRLF = "\r\n";

/** 2026-10-08T08:00:00.000Z → 20261008T080000Z */
export function formatIcsDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Escapes TEXT values: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line to at most 75 octets per physical line. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Continuation lines start with a space, which counts towards the limit.
  let limit = 75;

  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

export function buildIcs(event: CalendarEvent, { now = new Date() }: { now?: Date } = {}): string {
  const cancelled = event.status === "cancelled";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//barber-booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(event.startsAt)}`,
    `DTEND:${formatIcsDate(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    event.description && `DESCRIPTION:${escapeIcsText(event.description)}`,
    event.location && `LOCATION:${escapeIcsText(event.location)}`,
    event.url && `URL:${event.url}`,
    event.organizer &&
      `ORGANIZER;CN=${escapeIcsText(event.organizer.name)}:mailto:${event.organizer.email}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line));

  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
