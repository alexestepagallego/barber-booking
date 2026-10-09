# ADR 0002: Serialise writes per barber with an advisory lock

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

With only the exclusion constraint from [ADR 0001](0001-database-enforced-no-overlap.md)
in place, the concurrency test suite (100 simultaneous bookings with random,
mutually overlapping times) never produced a double booking. It did,
however, regularly hang for 30 seconds or more.

The Postgres log showed why:

```
ERROR:  deadlock detected
DETAIL: Process 37102 waits for ShareLock on transaction 5281; blocked by process 37088.
        Process 37088 waits for ShareLock on transaction 5282; blocked by process 37102.
```

To check an exclusion constraint, Postgres first inserts the new index entry
and then looks for conflicting rows. If a conflicting row belongs to a
transaction that has not finished yet, it waits for it. Two transactions
whose ranges overlap can each find the other's row and wait on each other.
Postgres breaks that cycle by aborting one of them, but only after
`deadlock_timeout` (1 s). The aborted request is retried, collides again,
and the result is a deadlock storm with roughly one aborted transaction per
second.

## Decision

Every transaction that inserts an appointment or moves one (new bookings and reschedules) first takes a transaction-scoped advisory lock keyed on the (target) barber:

```sql
SELECT pg_advisory_xact_lock(7301, hashtext(:barber_id));
```

This is a mutex (a semaphore of size 1) that lives in Postgres:

- Requests for the same barber queue up and run one at a time, so no wait
  cycle can form.
- Requests for different barbers do not share a lock and still run in
  parallel.
- The lock is released automatically at `COMMIT`/`ROLLBACK`, even if the
  app crashes mid-request, so it cannot leak.
- It works across any number of app instances, unlike an in-memory lock.

The exclusion constraint stays. The lock is a throughput optimisation, and
the constraint is the guarantee. A test inserts concurrently without the
lock to prove the constraint still holds on its own.

As a second layer, booking and reschedule transactions that fail with `40P01` (deadlock) or `40001` (serialization failure) are attempted up to 5 times in total, with a linearly growing, jittered delay (10 ms × attempt × 0.5–1.5).

## Consequences

- At the time of this decision, the whole test suite (then 22 tests, including the 3 booking races of 50 to 100 requests) went from flaky 30 s+ timeouts to a stable ~1.4 s.
- Bookings for one barber are serialised. At barbershop scale, a handful of
  writes per minute at most, this costs nothing measurable.
- Any new write path that modifies a barber's schedule (reschedule, admin
  edits) must call `lockBarberSchedule()` to keep the same latency profile.
  Forgetting it is a performance bug, not a correctness bug.
