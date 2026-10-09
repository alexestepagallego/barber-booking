# ADR 0001: Enforce "no overlapping appointments" in the database

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

The one thing a booking system must never do is give the same barber two
customers at the same time. Most small booking sites, including this
project's predecessor ([chanebarber](https://github.com/alexestepagallego/chanebarber)),
implement it as:

1. Ask the server which times are taken.
2. If the chosen time is free, save the booking.

Steps 1 and 2 are separate operations. Two customers who submit at nearly the
same moment both pass step 1 before either reaches step 2, and both get
booked. This is a time-of-check to time-of-use (TOCTOU) race. It does not
need heavy traffic to happen: a double tap on a slow mobile connection is
enough.

The app runs on Vercel, so several instances of the server can run at once.
That rules out any lock kept in application memory.

## Options considered

| Option                                                    | Verdict                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check then insert in application code                     | Racy (see above). Rejected.                                                                                                                                                                 |
| In-memory mutex or semaphore                              | Only works within one process; serverless runs many. Rejected.                                                                                                                              |
| `SERIALIZABLE` transactions                               | Correct, but every conflict surfaces as a generic serialization failure that must be retried, and the guarantee is only as good as every code path remembering to use that isolation level. |
| `UNIQUE (barber_id, starts_at)`                           | Only catches identical start times. A 45-minute booking at 10:00 and a 30-minute one at 10:15 overlap but have different starts. Rejected.                                                  |
| Pre-generated slot rows locked with `SELECT … FOR UPDATE` | Works, but forces a fixed slot grid and needs every slot row to exist in advance. Services here have different durations.                                                                   |
| **Exclusion constraint on a time range**                  | Declarative, enforced by the database for every write path, handles any duration. **Chosen.**                                                                                               |

## Decision

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    barber_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status = 'confirmed');
```

- `'[)'` ranges are half-open, so 10:00–10:30 and 10:30–11:00 do not
  conflict.
- Only `confirmed` appointments take part, so cancelling frees the time.
- The application never asks "is this free?" before writing. It inserts, and
  turns SQLSTATE `23P01` (exclusion violation) into a `409 Conflict` with a
  friendly message.

## Consequences

- **Correct by construction.** Every write path is covered, including admin
  edits, scripts and future code, and so is a manual `psql` session.
- **Requires PostgreSQL** with the `btree_gist` extension (available on Neon,
  Supabase, RDS and stock Postgres). This is a deliberate trade-off against
  database portability.
- Drizzle cannot express exclusion constraints, so this lives in a
  hand-written migration (`drizzle/0001_no_overlapping_appointments.sql`).
- Under heavy contention on one barber, concurrent inserts can deadlock each
  other. That never breaks the invariant, but it hurts latency. Handled in
  [ADR 0002](0002-per-barber-advisory-lock.md).
