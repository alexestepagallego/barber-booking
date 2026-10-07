# How availability is computed

Availability answers the question _"at what times can I book this service on
this day, and with whom?"_. The answer is a **hint for the UI**: the times
shown can be taken by someone else before the customer submits. The final
word belongs to the database constraint described in
[concurrency.md](concurrency.md).

## Two layers

| File                                     | Role                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/booking/availability.ts`     | **Pure engine.** No database and no clock. Every input, including "now", is a parameter.                                         |
| `src/server/booking/get-availability.ts` | **Loader.** Reads settings, the service, eligible barbers, shifts, time off and appointments for the day, then calls the engine. |

Keeping the engine pure means the tricky part, time arithmetic, is covered
by fast unit tests with fixed inputs, including dates that only happen
twice a year.

## Inputs

- **Shop settings:** time zone (`Europe/Madrid`), slot grid (15 min), booking
  horizon (60 days) and minimum notice (60 min).
- **Service duration:** for example, 15 min for a beard trim or 45 min for a
  cut with beard.
- **Per eligible barber** (active and offering the service):
  - shifts for that weekday, which can be split (09:00–13:30 and
    16:00–20:00),
  - busy intervals: confirmed appointments, personal time off and
    shop-wide closures,
  - minutes already booked that day.

## Rules

A start time is offered for a barber when **all** of these hold:

1. The date is between today and today + horizon, in shop-local time.
2. It lies on the slot grid, counted from the start of the shift.
3. The **whole service** fits inside one shift, so a 45-minute cut never
   starts at 13:00 and runs into lunch.
4. It overlaps none of the barber's busy intervals. Intervals are half-open,
   so back-to-back bookings are allowed.
5. It starts at least `minNoticeMinutes` after now.

The results for all barbers are merged into one list sorted by time. Each
slot lists the barbers who can take it, **least booked first**. A "no
preference" booking tries them in that order, which spreads work evenly.

## Time zones and daylight saving

Two kinds of time are kept strictly apart:

- **Wall-clock times** such as "09:00" on "2026-10-25". Working hours are
  stored this way (`time` columns), because the shop opens at 9 in winter
  and in summer.
- **Instants**, stored as `timestamptz`. Appointments, time off and returned
  slots use these.

They are converted day by day through the shop's IANA time zone, so:

| Day                            | 09:00 Madrid is | Day length |
| ------------------------------ | --------------- | ---------- |
| 2026-03-28 (winter time)       | 08:00 UTC       | 24 h       |
| 2026-03-29 (clocks go forward) | 07:00 UTC       | **23 h**   |
| 2026-10-25 (clocks go back)    | 08:00 UTC       | **25 h**   |

On the spring-forward night the local hour 02:00–02:59 does not exist, and
no slot is ever offered inside it. A service that spans the jump, such as
01:45 → 03:15 local, lasts its real 30 minutes and is offered correctly.
The tests cover both transition days.

The browser's clock and time zone are never trusted. "Now" and "today" are
computed on the server in the shop's time zone, so a customer abroad, or
with a wrong clock, sees the same times as everyone else.
