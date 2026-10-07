import { describe, expect, it } from "vitest";

import {
  addDays,
  computeAvailableSlots,
  dayBounds,
  isoWeekday,
  localDate,
  zonedDateTime,
  type AvailabilityQuery,
  type BarberSchedule,
} from "@/server/booking/availability";

const TZ = "Europe/Madrid";
const MONDAY = "2026-11-02";
const SPLIT_SHIFT = [
  { startTime: "09:00", endTime: "13:30" },
  { startTime: "16:00", endTime: "20:00" },
];

const barber = (overrides: Partial<BarberSchedule> = {}): BarberSchedule => ({
  barberId: "chane",
  shifts: SPLIT_SHIFT,
  busy: [],
  bookedMinutes: 0,
  ...overrides,
});

const query = (overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery => ({
  date: MONDAY,
  timezone: TZ,
  durationMinutes: 30,
  slotIntervalMinutes: 15,
  minNoticeMinutes: 60,
  bookingHorizonDays: 60,
  now: new Date("2026-10-30T12:00:00Z"),
  barbers: [barber()],
  ...overrides,
});

/** Local "HH:MM" of every returned start time, for readable assertions. */
const startTimes = (q: AvailabilityQuery) =>
  computeAvailableSlots(q).map((slot) =>
    slot.startsAt.toLocaleTimeString("en-GB", {
      timeZone: q.timezone,
      hour: "2-digit",
      minute: "2-digit",
    }),
  );

const local = (date: string, time: string) => zonedDateTime(date, time, TZ);

describe("calendar helpers", () => {
  it("computes ISO weekdays", () => {
    expect(isoWeekday("2026-11-02")).toBe(1); // Monday
    expect(isoWeekday("2026-11-08")).toBe(7); // Sunday
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => isoWeekday("2026-2-1")).toThrow(RangeError);
    expect(() => isoWeekday("2026-02-30")).toThrow(RangeError);
  });

  it("reads the local date of an instant, not the UTC one", () => {
    // 23:30 UTC on Nov 2nd is already Nov 3rd in Madrid.
    expect(localDate(new Date("2026-11-02T23:30:00Z"), TZ)).toBe("2026-11-03");
  });
});

describe("daylight saving time (Europe/Madrid)", () => {
  it("maps 09:00 to different UTC instants before and after the change", () => {
    expect(local("2026-03-28", "09:00").toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(local("2026-03-29", "09:00").toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(local("2026-10-25", "09:00").toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("knows that local days are 23 h and 25 h long on transition days", () => {
    const hours = (date: string) => {
      const { start, end } = dayBounds(date, TZ);
      return (end.getTime() - start.getTime()) / 3_600_000;
    };
    expect(hours("2026-03-29")).toBe(23);
    expect(hours("2026-10-25")).toBe(25);
    expect(hours(MONDAY)).toBe(24);
  });

  it("never offers a slot inside the hour that does not exist on spring-forward night", () => {
    // A night shift 01:00–04:00 local that crosses 02:00 → 03:00 lasts 2 real hours.
    const q = query({
      date: "2026-03-29",
      now: new Date("2026-03-20T12:00:00Z"),
      barbers: [barber({ shifts: [{ startTime: "01:00", endTime: "04:00" }] })],
    });

    const times = startTimes(q);
    // 01:45 → 03:15 local is only 30 real minutes, because the clock jumps
    // from 02:00 to 03:00 in between, so it is a valid slot.
    expect(times).toEqual(["01:00", "01:15", "01:30", "01:45", "03:00", "03:15", "03:30"]);
    expect(times.some((t) => t.startsWith("02:"))).toBe(false);
  });

  it("keeps the regular schedule on both transition days", () => {
    for (const date of ["2026-03-28", "2026-10-24"]) {
      const times = startTimes(query({ date, now: new Date(`${addDays(date, -5)}T12:00:00Z`) }));
      expect(times[0]).toBe("09:00");
      expect(times.at(-1)).toBe("19:30");
    }
  });
});

describe("computeAvailableSlots", () => {
  it("offers every grid start where the service fits, per shift", () => {
    const times = startTimes(query());

    expect(times.slice(0, 3)).toEqual(["09:00", "09:15", "09:30"]);
    // Last morning start: 13:00 + 30 min = 13:30, the end of the shift.
    expect(times).toContain("13:00");
    expect(times).not.toContain("13:15");
    // Nothing during the lunch break.
    expect(times.filter((t) => t > "13:00" && t < "16:00")).toEqual([]);
    expect(times.at(-1)).toBe("19:30");
    expect(times).toHaveLength(17 + 15);
  });

  it("does not let a long service run into the lunch break", () => {
    const times = startTimes(query({ durationMinutes: 45 }));
    expect(times).toContain("12:45");
    expect(times).not.toContain("13:00");
  });

  it("excludes every start that would overlap an existing appointment", () => {
    const busy = [{ start: local(MONDAY, "10:00"), end: local(MONDAY, "10:30") }];
    const times = startTimes(query({ barbers: [barber({ busy })] }));

    // 09:30 ends exactly at 10:00 and 10:30 starts exactly at its end: both fine.
    expect(times).toContain("09:30");
    expect(times).toContain("10:30");
    expect(times).not.toContain("09:45");
    expect(times).not.toContain("10:00");
    expect(times).not.toContain("10:15");
  });

  it("returns nothing on a day without shifts", () => {
    expect(startTimes(query({ barbers: [barber({ shifts: [] })] }))).toEqual([]);
  });

  it("returns nothing when time off covers the whole day", () => {
    const busy = [dayBounds(MONDAY, TZ)];
    expect(startTimes(query({ barbers: [barber({ busy })] }))).toEqual([]);
  });

  it("respects the minimum notice on the same day", () => {
    // 09:20 local, 60 min notice → the first possible start is 10:30 on the grid.
    const now = local(MONDAY, "09:20");
    expect(startTimes(query({ now }))[0]).toBe("10:30");
  });

  it("returns nothing for past dates and dates beyond the horizon", () => {
    const now = local(MONDAY, "08:00");
    expect(startTimes(query({ now, date: addDays(MONDAY, -1) }))).toEqual([]);
    expect(startTimes(query({ now, date: addDays(MONDAY, 60) }))).not.toEqual([]);
    expect(startTimes(query({ now, date: addDays(MONDAY, 61) }))).toEqual([]);
  });

  it("merges barbers into one list, least booked first", () => {
    const leoBusy = [{ start: local(MONDAY, "09:00"), end: local(MONDAY, "09:30") }];
    const slots = computeAvailableSlots(
      query({
        barbers: [
          barber({ barberId: "chane", bookedMinutes: 120 }),
          barber({ barberId: "leo", bookedMinutes: 30, busy: leoBusy }),
        ],
      }),
    );

    expect(slots[0]?.barberIds).toEqual(["chane"]); // Leo is busy at 09:00
    expect(
      slots.find((s) => s.startsAt.getTime() === local(MONDAY, "10:00").getTime())?.barberIds,
    ).toEqual(["leo", "chane"]);
  });

  it("returns slots with the right end time", () => {
    const [first] = computeAvailableSlots(query({ durationMinutes: 40 }));
    expect(first).toBeDefined();
    expect(first!.endsAt.getTime() - first!.startsAt.getTime()).toBe(40 * 60_000);
  });

  it("accepts times in Postgres 'HH:MM:SS' format", () => {
    const shifts = [{ startTime: "09:00:00", endTime: "10:00:00" }];
    expect(startTimes(query({ barbers: [barber({ shifts })] }))).toEqual([
      "09:00",
      "09:15",
      "09:30",
    ]);
  });
});
