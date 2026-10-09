import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  insertAppointment,
  insertAppointmentWithAnyBarber,
} from "@/server/booking/appointments-repository";
import { SlotUnavailableError } from "@/server/booking/errors";
import { appointments } from "@/server/db/schema";

import { addMinutes, at, createTestDb, customer, resetDatabase } from "./test-db";

/**
 * These tests fire many requests at the database truly in parallel: each one
 * runs on its own pooled connection, and all of them are released at the same
 * instant by a shared "starting gun" promise.
 */
const CONCURRENCY = 50;
const { db, client } = createTestDb(CONCURRENCY + 5);

let barberIds: string[];
let serviceId: string;

beforeEach(async () => {
  const seeded = await resetDatabase(db);
  barberIds = seeded.barbers.map((b) => b.id);
  serviceId = seeded.services.find((s) => s.slug === "classic-cut")!.id;
  await warmUpConnections();
});

afterAll(() => client.end());

/** Opens every pooled connection up front so connection setup does not serialise the race. */
async function warmUpConnections() {
  await Promise.all(Array.from({ length: CONCURRENCY }, () => client`SELECT pg_sleep(0.02)`));
}

/** Runs all tasks at the same moment and reports how each one ended. */
async function race<T>(tasks: Array<() => Promise<T>>) {
  let fire!: () => void;
  const startingGun = new Promise<void>((resolve) => (fire = resolve));
  const running = tasks.map(async (task) => {
    await startingGun;
    return task();
  });
  fire();
  return Promise.allSettled(running);
}

function summarise<T>(results: PromiseSettledResult<T>[]) {
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  const unexpected = rejected.filter((r) => !(r.reason instanceof SlotUnavailableError));
  return { fulfilled, rejected, unexpected };
}

/** Pairs of confirmed appointments of the same barber whose time ranges overlap. Must always be 0. */
async function countOverlappingPairs(): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM appointments a
    JOIN appointments b
      ON a.barber_id = b.barber_id
     AND a.id < b.id
     AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
    WHERE a.status = 'confirmed' AND b.status = 'confirmed'
  `);
  return result[0]!.count;
}

describe(`${CONCURRENCY} simultaneous requests`, () => {
  it("for the same barber and time: exactly one succeeds", async () => {
    const start = at("10:00");
    const results = await race(
      Array.from(
        { length: CONCURRENCY },
        (_, i) => () =>
          insertAppointment(db, {
            ...customer,
            customerEmail: `customer${i}@example.com`,
            barberId: barberIds[0]!,
            serviceId,
            startsAt: start,
            endsAt: addMinutes(start, 30),
            actor: "customer",
          }),
      ),
    );

    const { fulfilled, rejected, unexpected } = summarise(results);
    expect(unexpected).toEqual([]);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(CONCURRENCY - 1);
    expect(await db.$count(appointments)).toBe(1);
  });

  it(`with "no preference" and ${2} free barbers: exactly one booking per barber`, async () => {
    const start = at("10:00");
    const results = await race(
      Array.from(
        { length: CONCURRENCY },
        (_, i) => () =>
          insertAppointmentWithAnyBarber(db, barberIds, {
            ...customer,
            customerEmail: `customer${i}@example.com`,
            serviceId,
            startsAt: start,
            endsAt: addMinutes(start, 30),
            actor: "customer",
          }),
      ),
    );

    const { fulfilled, unexpected } = summarise(results);
    expect(unexpected).toEqual([]);
    expect(fulfilled).toHaveLength(barberIds.length);

    const bookedBarbers = fulfilled.map((r) => r.value.appointment.barberId).sort();
    expect(bookedBarbers).toEqual([...barberIds].sort());
  });

  it("with random overlapping times and durations: never an overlap, never a false rejection", async () => {
    // A deterministic pseudo-random generator so a failure is reproducible.
    let seed = 42;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;

    const requests = Array.from({ length: CONCURRENCY * 2 }, () => {
      const startsAt = addMinutes(at("09:00"), Math.floor(random() * 24) * 5);
      const duration = [15, 30, 40, 45][Math.floor(random() * 4)]!;
      return {
        barberId: barberIds[Math.floor(random() * barberIds.length)]!,
        startsAt,
        endsAt: addMinutes(startsAt, duration),
      };
    });

    const results = await race(
      requests.map(
        (request) => () =>
          insertAppointment(db, { ...customer, ...request, serviceId, actor: "customer" }),
      ),
    );

    const { fulfilled, rejected, unexpected } = summarise(results);
    expect(unexpected).toEqual([]);
    expect(fulfilled.length + rejected.length).toBe(requests.length);
    expect(await countOverlappingPairs()).toBe(0);

    // Every rejection must be justified: it overlaps something that was accepted.
    const accepted = fulfilled.map((r) => r.value.appointment);
    results.forEach((result, i) => {
      if (result.status === "fulfilled") return;
      const request = requests[i]!;
      const conflict = accepted.some(
        (a) =>
          a.barberId === request.barberId &&
          a.startsAt < request.endsAt &&
          request.startsAt < a.endsAt,
      );
      expect(conflict, `request #${i} was rejected without a conflicting booking`).toBe(true);
    });
  });
});

describe("defence in depth", () => {
  // Without the lock, mutually overlapping inserts deadlock and Postgres
  // resolves one deadlock per second (deadlock_timeout): the very storm the
  // lock exists to prevent. 10 requests prove the point without making the
  // test slow on CI machines.
  const UNLOCKED = 10;

  it(
    "the constraint alone still prevents double booking when a write path skips the lock",
    { timeout: 60_000 },
    async () => {
      const start = at("10:00");
      const results = await race(
        Array.from(
          { length: UNLOCKED },
          (_, i) => () =>
            db.insert(appointments).values({
              ...customer,
              barberId: barberIds[0]!,
              serviceId,
              startsAt: start,
              endsAt: addMinutes(start, 30),
              manageTokenHash: `raw-insert-${i}`,
              priceCents: 1500,
            }),
        ),
      );

      const rejectionCodes = new Set(
        results
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => (r.reason as { cause?: { code?: string } }).cause?.code),
      );
      // Without the lock some losers may see a deadlock instead of a clean
      // conflict, which is exactly why the app takes the lock, but none of
      // them gets in.
      expect([...rejectionCodes].every((code) => code === "23P01" || code === "40P01")).toBe(true);
      expect(await db.$count(appointments)).toBe(1);
    },
  );
});

/**
 * The counter-example: the classic "check, then insert" implementation that
 * most booking forms use (and that chanebarber's Apps Script used). It runs
 * against a scratch table WITHOUT the exclusion constraint.
 *
 * A barrier makes every request finish its check before anyone inserts. That
 * does not invent the bug, it only makes a race window that exists in
 * production happen on every run, so the test is deterministic.
 */
describe("counter-example: check-then-insert without the constraint", () => {
  beforeEach(async () => {
    await db.execute(sql`
      DROP TABLE IF EXISTS naive_bookings;
      CREATE TABLE naive_bookings (barber_id uuid, starts_at timestamptz, ends_at timestamptz);
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DROP TABLE IF EXISTS naive_bookings`);
  });

  it("double-books under concurrency", async () => {
    // Raw SQL bypasses Drizzle's column mapping, so pass timestamps as ISO strings.
    const start = at("10:00").toISOString();
    const end = addMinutes(at("10:00"), 30).toISOString();
    let checked = 0;
    let allChecked!: () => void;
    const barrier = new Promise<void>((resolve) => (allChecked = resolve));

    await race(
      Array.from({ length: CONCURRENCY }, () => async () => {
        // 1. "Is the slot free?"
        const [row] = await db.execute<{ taken: boolean }>(sql`
          SELECT EXISTS (
            SELECT 1 FROM naive_bookings
            WHERE barber_id = ${barberIds[0]} AND starts_at < ${end} AND ${start} < ends_at
          ) AS taken
        `);
        if (++checked === CONCURRENCY) allChecked();
        await barrier;
        // 2. "Yes, so insert."
        if (!row!.taken) {
          await db.execute(sql`
            INSERT INTO naive_bookings VALUES (${barberIds[0]}, ${start}, ${end})
          `);
        }
      }),
    );

    const [result] = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM naive_bookings`,
    );
    expect(result!.count).toBe(CONCURRENCY);
  });
});
