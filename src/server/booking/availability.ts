import { TZDate } from "@date-fns/tz";

import { addDays, isoWeekday, parseDate } from "@/lib/calendar";

export { addDays, isoWeekday };

/**
 * Availability engine. Pure functions only: no database, no clock. Every
 * input, including "now", is passed in, so the logic can be tested
 * exhaustively, daylight-saving transitions included.
 *
 * Two kinds of time are involved:
 * - Wall-clock times ("09:00" on "2026-10-25") as the shop thinks about them.
 *   Working hours are stored this way so that "we open at 9" stays true
 *   all year round.
 * - Instants (`Date`), absolute points in time. Appointments, time off and
 *   every returned slot use these.
 * The conversion between both always goes through the shop's IANA time zone.
 */

export type Interval = { start: Date; end: Date };

export type BarberSchedule = {
  barberId: string;
  /** Shifts for the requested weekday, as wall-clock "HH:MM" or "HH:MM:SS". */
  shifts: ReadonlyArray<{ startTime: string; endTime: string }>;
  /** Confirmed appointments and time off (personal or shop-wide) that day. */
  busy: readonly Interval[];
  /** Minutes already booked that day. Used to suggest the least busy barber first. */
  bookedMinutes: number;
};

export type AvailabilityQuery = {
  /** Shop-local calendar date, "YYYY-MM-DD". */
  date: string;
  timezone: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  bookingHorizonDays: number;
  now: Date;
  barbers: readonly BarberSchedule[];
};

export type Slot = {
  startsAt: Date;
  endsAt: Date;
  /** Barbers free for the whole slot, least busy first. */
  barberIds: string[];
};

const MINUTE = 60_000;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

function parseTime(time: string): { hours: number; minutes: number } {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new RangeError(`Invalid time "${time}", expected HH:MM`);
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/**
 * The instant at which the shop's clocks show `time` on `date`.
 * On the spring-forward day a non-existent time (02:30 in Madrid) moves
 * forward to the first valid one; on the fall-back day an ambiguous time
 * resolves to its first occurrence.
 */
export function zonedDateTime(date: string, time: string, timezone: string): Date {
  const { year, month, day } = parseDate(date);
  const { hours, minutes } = parseTime(time);
  return new Date(new TZDate(year, month - 1, day, hours, minutes, timezone).getTime());
}

/** Calendar date ("YYYY-MM-DD") of an instant as seen in `timezone`. */
export function localDate(instant: Date, timezone: string): string {
  const local = new TZDate(instant.getTime(), timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
}

/**
 * The shop-local day as an instant interval [start of day, start of next day).
 * Not always 24 h: 23 h on spring-forward day, 25 h on fall-back day.
 */
export function dayBounds(date: string, timezone: string): Interval {
  return {
    start: zonedDateTime(date, "00:00", timezone),
    end: zonedDateTime(addDays(date, 1), "00:00", timezone),
  };
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Lists every start time at which the service fits for at least one barber.
 *
 * A start time is offered for a barber when:
 * 1. the date is between today and today + horizon (shop-local),
 * 2. it lies on the slot grid, counted from the start of the shift,
 * 3. the whole service fits inside a single shift (no running into lunch),
 * 4. it overlaps none of the barber's appointments or time off,
 * 5. it is at least `minNoticeMinutes` after `now`.
 *
 * Results are sorted by time. Each slot lists the barbers who can take it,
 * least booked first, which is the order "no preference" bookings try them in.
 */
export function computeAvailableSlots(query: AvailabilityQuery): Slot[] {
  const { date, timezone, durationMinutes, slotIntervalMinutes, now } = query;
  if (durationMinutes <= 0 || slotIntervalMinutes <= 0) {
    throw new RangeError("Durations must be positive");
  }

  const today = localDate(now, timezone);
  if (date < today || date > addDays(today, query.bookingHorizonDays)) return [];

  const earliestStart = now.getTime() + query.minNoticeMinutes * MINUTE;
  const duration = durationMinutes * MINUTE;
  const step = slotIntervalMinutes * MINUTE;

  const slots = new Map<number, { barberId: string; bookedMinutes: number }[]>();

  for (const barber of query.barbers) {
    for (const shift of barber.shifts) {
      const shiftStart = zonedDateTime(date, shift.startTime, timezone).getTime();
      const shiftEnd = zonedDateTime(date, shift.endTime, timezone).getTime();

      for (let start = shiftStart; start + duration <= shiftEnd; start += step) {
        if (start < earliestStart) continue;
        const candidate = { start: new Date(start), end: new Date(start + duration) };
        if (barber.busy.some((busy) => overlaps(candidate, busy))) continue;

        const free = slots.get(start) ?? [];
        free.push({ barberId: barber.barberId, bookedMinutes: barber.bookedMinutes });
        slots.set(start, free);
      }
    }
  }

  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, free]) => ({
      startsAt: new Date(start),
      endsAt: new Date(start + duration),
      // Array.prototype.sort is stable, so ties keep the input (display) order.
      barberIds: free.sort((a, b) => a.bookedMinutes - b.bookedMinutes).map((f) => f.barberId),
    }));
}
