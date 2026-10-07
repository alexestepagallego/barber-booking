import { sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Arbitrary constant that namespaces our advisory locks, so they cannot clash
 * with advisory locks taken by anything else using the same database.
 */
const SCHEDULE_LOCK_NAMESPACE = 7_301;

/**
 * A per-barber mutex (semaphore of size 1) that lives in Postgres.
 *
 * Why it exists: the exclusion constraint alone is always correct, but when
 * many transactions insert mutually overlapping ranges at the same instant,
 * they can wait on each other in a cycle. Postgres resolves that with a
 * deadlock error after `deadlock_timeout` (1 s by default), and under heavy
 * contention the retries collide again, a "deadlock storm".
 *
 * Taking this lock first makes concurrent writes to the SAME barber's
 * schedule queue up in order, so no cycle can form. Writes for different
 * barbers still run in parallel.
 *
 * Properties:
 * - Works across any number of app instances (unlike an in-memory mutex).
 * - Transaction-scoped: released automatically on COMMIT or ROLLBACK, even
 *   if the app process dies mid-request, so it can never leak.
 * - Only an optimisation for throughput: correctness still comes from the
 *   `appointments_no_overlap` constraint, which also guards any write path
 *   that forgets to take the lock.
 *
 * hashtext() maps the uuid to an int4. A collision between two barbers only
 * means they share a queue, which is harmless.
 */
export async function lockBarberSchedule(tx: Tx, barberId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${SCHEDULE_LOCK_NAMESPACE}, hashtext(${barberId}))`,
  );
}
