# Testing

Three levels, all running in CI on every push to `main` and on every pull request:

| Level       | Tool       | Runs against                                    | What it proves                                                                                                                                                              |
| ----------- | ---------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest     | nothing (pure functions)                        | availability maths (split shifts, DST), calendar files, schemas, tokens, retry logic, rate-limit and Turnstile clients, security headers                                    |
| Integration | Vitest     | a real PostgreSQL                               | booking rules, the no-overlap guarantee **under concurrency**, manage-link changes, emails and reminders, admin auth and catalogue, rate limiting, demo reset, data erasure |
| End-to-end  | Playwright | `next build` + `next start`, desktop and mobile | customer journey, double booking from the UI, admin panel, accessibility (axe-core WCAG 2.1 AA), HTTP headers, cron auth                                                    |

```bash
npm test                    # unit + integration
npm run test:unit
npm run test:integration    # needs TEST_DATABASE_URL
npm run test:e2e            # needs E2E_DATABASE_URL; builds the app first
npm run screenshots         # regenerates docs/screenshots
```

## The concurrency tests

`tests/integration/concurrency.test.ts` is the heart of the suite. In the 50-request tests every request gets its own pooled connection (the pool has 55, and 50 are opened in advance); the 100-request random test shares that pool. In all of them, every request is released at once by a shared promise. That makes the
races real, not sequential.

- 50 bookings of the same barber and time → **exactly 1** succeeds.
- 50 "no preference" bookings with 2 free barbers → **exactly 2**.
- 100 bookings with random times, durations and barbers → **0** overlapping
  pairs in the database, and every rejection really overlaps an accepted
  booking (no false rejections). The generator is seeded, so failures can
  be reproduced.
- 10 raw inserts that skip the lock → still exactly 1 (the constraint holds
  on its own).
- A counter-example without the constraint shows that check-then-insert
  books all 50.

More races are covered next to the code they protect: two simultaneous
cancellations, two customers moving into the same time, a cancellation
racing a reschedule, overlapping reminder runs, and 20 concurrent hits on
a rate limit of 5.

## Test databases

Integration tests `TRUNCATE` everything and reseed before each test. They
refuse to run unless the database name contains `test`. E2E tests use
their own database (the name must contain `e2e`), which is reset before
each run. The catalogue is upserted rather than truncated there, so its ids
stay stable for the running server's cache.

## What the tests found

The suites were not written after the fact. They found real bugs, which are
documented in the commits:

- Deadlock storms under contention, which led to the advisory lock
  ([ADR 0002](adr/0002-per-barber-advisory-lock.md)).
- Emails with a trailing space being rejected, a common result of mobile
  autocomplete.
- A tap before hydration selecting a service without React noticing.
- On mobile, visually hidden radios escaping the day strip, widening the
  page and making the browser zoom out (Playwright on a Pixel 7 profile).
- `Referrer-Policy: no-referrer` making browsers send `Origin: null`, which
  broke logout.
- Lost success messages and stale availability responses.

Two adversarial multi-agent code reviews then went over the result:
first phases 4–5 (manage links, emails), later phases 6–7 (admin panel,
hardening). Each used four independent lenses (concurrency, security,
framework correctness, UX and accessibility), and a separate agent tried
to refute every finding before it counted. About 40 distinct confirmed issues
were fixed, each with a regression test where one was possible. Examples:

- A lost update between concurrent reschedules.
- Reminders never retried after a failure.
- Email idempotency keys colliding when a booking moved back to an
  earlier time.
- Personal data in error logs.
- Anyone who knew the owner's email could lock the owner out of the admin
  panel, through a per-account limit that counted correct passwords too.
- A database copy was enough to replay a booking and obtain its manage
  link, because idempotency keys were stored in plain text.
- Deactivating a service made its existing bookings impossible to move,
  and changing a duration stretched old bookings when they were moved.
- Two simultaneous schedule saves merged into overlapping shifts.

## Manual checks still worth doing before a release

- Book from a real phone, on mobile data.
- Open the confirmation email in Gmail and Outlook, and add the invite to
  Google, Apple and Outlook calendars.
- Use the whole site with only a keyboard, and with VoiceOver or NVDA.
