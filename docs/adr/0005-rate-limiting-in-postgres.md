# ADR 0005: Rate limiting with a counter table in Postgres

- **Status:** Accepted
- **Date:** 2026-10-08 (supersedes the plan to use Upstash Redis)

## Context

The public endpoints need limits:

- Bookings send an email to whatever address is typed, so without limits
  the form can be used to flood someone's inbox.
- Availability is the most frequently called endpoint.
- Cancel and reschedule are protected by a secret token, but should still
  be bounded.
- Admin login must slow down password guessing.

On serverless, in-memory counters do not work: every instance has its own
memory. The usual answer is Redis (Upstash). That means another service,
another account and another secret, and in tests it has to be mocked or
run locally.

## Decision

Fixed-window counters in a Postgres table, updated with one atomic upsert:

```sql
-- $now comes from the application (so tests can control the clock).
INSERT INTO rate_limits (key, count, reset_at) VALUES ($key, 1, $now + $window)
ON CONFLICT (key) DO UPDATE SET
  count    = CASE WHEN rate_limits.reset_at <= $now THEN 1 ELSE rate_limits.count + 1 END,
  reset_at = CASE WHEN rate_limits.reset_at <= $now THEN $now + $window ELSE rate_limits.reset_at END
RETURNING count, reset_at;
```

All the limits are in one place (`RATE_LIMITS` in
`src/server/security/rate-limit.ts`):

| Rule                              | Limit           | Counted                                                                 |
| --------------------------------- | --------------- | ----------------------------------------------------------------------- |
| New bookings per IP               | 10 / hour       | every request that passes validation and the honeypot, before Turnstile |
| Confirmation emails per recipient | 5 / day         | only bookings actually created, checked after the bot check             |
| Availability lookups per IP       | 120 / minute    | every request                                                           |
| Cancel/reschedule per IP          | 30 / hour       | every request                                                           |
| Admin sign-in per IP              | 20 / 15 minutes | every attempt                                                           |
| Failed sign-ins per account + IP  | 5 / 15 minutes  | failures only; a success clears it                                      |
| Failed sign-ins per account       | 50 / hour       | failures only                                                           |

Two details came out of the adversarial review:

- **Failure-only limits.** Counting every sign-in per account let anyone
  who knew the owner's email lock the owner out, and five visitors locked
  out the public demo. Those limits are now read first (`peekRateLimit`) and incremented only on failure. One is keyed by account and IP; the other, a ceiling of 50 an hour, by account only.
- **Keys are normalised.** A per-recipient budget keyed by the raw address
  could be bypassed with `ana+1@…` or Gmail dots, and a per-IP budget with
  the 2^64 addresses of an IPv6 /64. Both keys are normalised
  (`rateLimitEmailKey`, `rateLimitIpKey`).

The client IP is the first `x-forwarded-for` entry, which Vercel sets and
overwrites. Expired rows are deleted by the nightly maintenance cron.
On the API endpoints, exceeding a limit returns `429` with `Retry-After`; the admin sign-in form shows "Too many attempts. Try again in N min." instead.

## Consequences

- No extra service: it works the same locally, in CI and in production, and
  it is covered by real-database tests. One test checks that 20 concurrent
  requests against a limit of 5 let exactly 5 through.
- Each limited request costs one small database write. That is fine at a
  barbershop's traffic. At much higher volume, the same interface could be
  backed by Redis without touching the callers.
- Fixed windows allow up to twice the limit across a window boundary. That
  is acceptable here, because these limits stop abuse rather than meter
  usage.
- These limits are not DDoS protection. That belongs to the platform
  (Vercel's firewall), as the Next.js docs also recommend.
