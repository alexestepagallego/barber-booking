# ADR 0007: Send emails after the response, never inside the booking

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Every booking change sends an email: confirmation, new time, cancellation,
and a reminder the day before. Email providers are slow, sometimes
unavailable, and rate limited. A booking must not fail, or wait seconds,
because of them. The alternative, a transactional outbox table with its own
worker, is the robust choice at scale, but it needs a frequently running
job. The Vercel Hobby plan allows crons only once a day.

## Decision

- **Transactional emails** are scheduled with Next.js `after()` once the
  database change has committed. The customer gets the HTTP response
  immediately and the email is sent in the background of the same
  invocation. Failures are logged without personal data and never undo the
  booking.
- **Idempotency.** Each email carries an `Idempotency-Key` of
  `appointmentId:kind:calendarSequence`, so provider retries never
  duplicate it, while every real change gets its own email. That includes
  moving an appointment back to an earlier time (a review found the first
  key design missed this case).
- **Calendar invites** (RFC 5545, written by hand in `src/lib/ics.ts`) use a
  stable `UID` per appointment and a `SEQUENCE` that grows with each
  reschedule (+1 when cancelled). Calendar apps update or remove the same
  event. The "Add to calendar" button on the manage page uses the same
  sequence.
- **Reminders** run from a daily cron over a window that starts in one hour
  and ends at the end of tomorrow:
  - Each appointment is claimed with its own conditional `UPDATE` right
    before sending, re-checking it is still confirmed at the same time.
  - A failed send releases the claim, so the next day's run retries it if
    the appointment has not started.
  - The run stops after a 40 s budget (the function limit is 60 s), and the
    rest is left for the next run.
- **Transports:** Resend in production, called with `fetch` because one
  endpoint does not justify an SDK. HTML files in `./.mail` locally. Logs
  only on Vercel without a key. An in-memory transport for tests.

## Consequences

- A booking never waits for, or fails because of, the email provider.
- If the process dies between the commit and the email, that email is lost.
  The customer still saw the confirmation on screen, with the manage link.
  An outbox would close this gap, and it is the natural next step if a
  paid plan allows a frequent worker.
- Staff bookings without an email address send nothing, and the reminder
  query skips them.
