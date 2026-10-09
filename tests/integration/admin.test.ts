import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createAdminUser,
  createSession,
  deleteSession,
  findSession,
  purgeExpiredSessions,
  SESSION_TTL_MS,
  verifyCredentials,
} from "@/server/admin/auth";
import {
  addTimeOff,
  saveBarber,
  saveService,
  saveWeekSchedule,
} from "@/server/admin/catalogue-admin";
import { attemptLogin } from "@/server/admin/login";
import { zonedDateTime } from "@/server/booking/availability";
import { createBooking } from "@/server/booking/create-booking";
import { getAvailability } from "@/server/booking/get-availability";
import {
  adminSessions,
  adminUsers,
  barberServices,
  barbers,
  services,
  workingHours,
} from "@/server/db/schema";
import {
  checkRateLimit,
  peekRateLimit,
  purgeExpiredRateLimits,
  resetRateLimit,
} from "@/server/security/rate-limit";
import { hashToken } from "@/server/security/tokens";

import { createTestDb, customer, resetDatabase } from "./test-db";

const { db, client } = createTestDb(10);
const PASSWORD = "correct horse battery staple";
const MONDAY = "2030-06-03";
const now = new Date("2030-06-01T10:00:00Z");
const local = (time: string, date = MONDAY) => zonedDateTime(date, time, "Europe/Madrid");

let seeded: Awaited<ReturnType<typeof resetDatabase>>;

beforeEach(async () => {
  seeded = await resetDatabase(db);
});

afterAll(() => client.end());

describe("admin authentication", () => {
  it("stores an argon2id hash, never the password, and normalises the email", async () => {
    await createAdminUser(db, { email: "  Owner@Example.COM ", name: "Owner", password: PASSWORD });
    const [user] = await db.select().from(adminUsers);

    expect(user?.email).toBe("owner@example.com");
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(PASSWORD);
  });

  it("rejects short passwords", async () => {
    await expect(
      createAdminUser(db, { email: "a@example.com", name: "A", password: "short" }),
    ).rejects.toThrow(/12 characters/);
  });

  it("verifies credentials, case-insensitively for the email only", async () => {
    await createAdminUser(db, { email: "owner@example.com", name: "Owner", password: PASSWORD });

    expect(await verifyCredentials(db, "OWNER@example.com", PASSWORD)).toMatchObject({
      email: "owner@example.com",
    });
    expect(
      await verifyCredentials(db, "owner@example.com", PASSWORD.toUpperCase()),
    ).toBeUndefined();
    expect(await verifyCredentials(db, "nobody@example.com", PASSWORD)).toBeUndefined();
  });

  it("creates sessions that are stored hashed, expire and can be revoked", async () => {
    const admin = await createAdminUser(db, {
      email: "owner@example.com",
      name: "Owner",
      password: PASSWORD,
    });
    const { token } = await createSession(db, admin.id, now);

    const [row] = await db.select().from(adminSessions);
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(await findSession(db, token, now)).toMatchObject({ id: admin.id });
    expect(await findSession(db, "forged-token", now)).toBeUndefined();

    const afterExpiry = new Date(now.getTime() + SESSION_TTL_MS + 1);
    expect(await findSession(db, token, afterExpiry)).toBeUndefined();
    expect(await purgeExpiredSessions(db, afterExpiry)).toBe(1);

    const second = await createSession(db, admin.id, now);
    await deleteSession(db, second.token);
    expect(await findSession(db, second.token, now)).toBeUndefined();
  });

  it("signs out every session when the password changes", async () => {
    const admin = await createAdminUser(db, {
      email: "owner@example.com",
      name: "Owner",
      password: PASSWORD,
    });
    const { token } = await createSession(db, admin.id, now);
    await createAdminUser(db, {
      email: "owner@example.com",
      name: "Owner",
      password: `${PASSWORD}!`,
    });

    expect(await findSession(db, token, now)).toBeUndefined();
  });
});

describe("attemptLogin", () => {
  const owner = { email: "owner@example.com", name: "Owner", password: PASSWORD };
  const tryLogin = (password: string, ip: string, at = now) =>
    attemptLogin(db, { email: owner.email, password, ip }, at);

  beforeEach(async () => {
    await createAdminUser(db, owner);
  });

  it("signs in with the right password", async () => {
    expect(await tryLogin(PASSWORD, "198.51.100.1")).toMatchObject({ ok: true });
  });

  it("a stranger who knows the owner's email cannot lock the owner out", async () => {
    for (let i = 0; i < 6; i++) await tryLogin("guess", "203.0.113.66");
    // The attacker's own IP is now blocked for this account…
    expect(await tryLogin("guess", "203.0.113.66")).toMatchObject({ reason: "rate_limited" });
    // …but the owner, from anywhere else, still gets in with the right password.
    expect(await tryLogin(PASSWORD, "198.51.100.1")).toMatchObject({ ok: true });
  });

  it("successful sign-ins never use up the per-account budget", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await tryLogin(PASSWORD, `198.51.100.${i}`)).toMatchObject({ ok: true });
    }
  });

  it("a success clears earlier failures from the same place", async () => {
    for (let i = 0; i < 4; i++) await tryLogin("typo", "198.51.100.1");
    expect(await tryLogin(PASSWORD, "198.51.100.1")).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++) {
      expect(await tryLogin("typo", "198.51.100.1")).toMatchObject({ reason: "invalid" });
    }
  });

  it("caps distributed guessing with an account-wide failure ceiling", async () => {
    for (let i = 0; i < 50; i++) await tryLogin("guess", `203.0.113.${i}`);
    expect(await tryLogin("guess", "203.0.113.200")).toMatchObject({ reason: "rate_limited" });
  });

  it("limits every attempt per IP", async () => {
    for (let i = 0; i < 20; i++) await tryLogin(PASSWORD, "198.51.100.9");
    expect(await tryLogin(PASSWORD, "198.51.100.9")).toMatchObject({ reason: "rate_limited" });
  });
});

describe("rate limiting", () => {
  const rule = { name: "test", limit: 3, windowSeconds: 60 };

  it("allows up to the limit within a window, then blocks until it resets", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(db, rule, "ip-1", now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfter).toBe(60);

    // Other subjects have their own counter.
    expect((await checkRateLimit(db, rule, "ip-2", now)).allowed).toBe(true);

    const nextWindow = new Date(now.getTime() + 61_000);
    expect(await checkRateLimit(db, rule, "ip-1", nextWindow)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
  });

  it("counts exactly under concurrency (no lost updates)", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => checkRateLimit(db, { ...rule, limit: 5 }, "burst", now)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("peeks without counting, and can be reset (failure-only limits)", async () => {
    const failures = { name: "fail", limit: 2, windowSeconds: 60 };
    expect((await peekRateLimit(db, failures, "x", now)).allowed).toBe(true);
    await checkRateLimit(db, failures, "x", now);
    await checkRateLimit(db, failures, "x", now);
    expect(await peekRateLimit(db, failures, "x", now)).toMatchObject({ allowed: false });
    // Peeking never consumed anything.
    expect(await peekRateLimit(db, failures, "x", now)).toMatchObject({ remaining: 0 });

    await resetRateLimit(db, failures, "x");
    expect((await peekRateLimit(db, failures, "x", now)).allowed).toBe(true);
  });

  it("purges expired counters", async () => {
    await checkRateLimit(db, rule, "old", now);
    expect(await purgeExpiredRateLimits(db, new Date(now.getTime() + 120_000))).toBe(1);
  });
});

describe("catalogue administration", () => {
  const chane = () => seeded.barbers.find((b) => b.slug === "chane")!.id;
  const cut = () => seeded.services.find((s) => s.slug === "classic-cut")!.id;

  it("creates a service with a unique slug, offered by every active barber", async () => {
    const id = await saveService(db, {
      name: "Classic cut",
      durationMinutes: 25,
      price: 14.5,
      sortOrder: 9,
      active: true,
    });
    const [row] = await db.select().from(services).where(eq(services.id, id));
    expect(row).toMatchObject({ slug: "classic-cut-2", priceCents: 1450, durationMinutes: 25 });

    const offered = await db.select().from(barberServices).where(eq(barberServices.serviceId, id));
    expect(offered).toHaveLength(seeded.barbers.length);
  });

  it("deactivating a service hides it from availability", async () => {
    await saveService(db, {
      id: cut(),
      name: "Classic cut",
      durationMinutes: 30,
      price: 15,
      sortOrder: 1,
      active: false,
    });
    await expect(getAvailability(db, { date: MONDAY, serviceId: cut(), now })).rejects.toThrow(
      /not found/i,
    );
  });

  it("updates which services a barber offers", async () => {
    await saveBarber(db, {
      id: chane(),
      name: "Chane",
      sortOrder: 1,
      active: true,
      serviceIds: [],
    });
    const slots = await getAvailability(db, { date: MONDAY, serviceId: cut(), now });
    expect(slots.flatMap((s) => s.barberIds)).not.toContain(chane());
  });

  it("replaces a barber's weekly schedule", async () => {
    const days = Array.from({ length: 7 }, () => [] as { startTime: string; endTime: string }[]);
    days[0] = [{ startTime: "10:00", endTime: "12:00" }]; // Monday only
    await saveWeekSchedule(db, { barberId: chane(), days });

    const slots = await getAvailability(db, {
      date: MONDAY,
      serviceId: cut(),
      barberId: chane(),
      now,
    });
    expect(slots[0]?.startsAt).toEqual(local("10:00"));
    expect(slots.at(-1)?.startsAt).toEqual(local("11:30"));
  });

  it("adding time off blocks bookings and reports appointments it overlaps", async () => {
    await createBooking(
      db,
      { ...customer, serviceId: cut(), barberId: chane(), startsAt: local("10:00") },
      { now },
    );
    const conflicts = await addTimeOff(
      db,
      { barberId: chane(), startDate: MONDAY, endDate: MONDAY, reason: "Dentist" },
      "Europe/Madrid",
    );
    expect(conflicts).toHaveLength(1);

    const slots = await getAvailability(db, {
      date: MONDAY,
      serviceId: cut(),
      barberId: chane(),
      now,
    });
    expect(slots).toEqual([]);
  });

  it("staff bookings skip the minimum notice but still cannot overlap", async () => {
    const soon = local("10:00");
    const fiveMinutesBefore = new Date(soon.getTime() - 5 * 60_000);
    const input = { ...customer, serviceId: cut(), barberId: chane(), startsAt: soon };

    await expect(createBooking(db, input, { now: fiveMinutesBefore })).rejects.toThrow();
    await expect(
      createBooking(db, input, { now: fiveMinutesBefore, actor: "admin" }),
    ).resolves.toBeTruthy();
    await expect(
      createBooking(db, input, { now: fiveMinutesBefore, actor: "admin" }),
    ).rejects.toThrow(/no longer available/);
  });

  it("two simultaneous schedule saves never merge: one of them wins whole", async () => {
    const week = (start: string, end: string) => {
      const days = Array.from({ length: 7 }, () => [] as { startTime: string; endTime: string }[]);
      days[0] = [{ startTime: start, endTime: end }];
      return days;
    };
    await Promise.all([
      saveWeekSchedule(db, { barberId: chane(), days: week("09:00", "13:00") }),
      saveWeekSchedule(db, { barberId: chane(), days: week("10:00", "14:00") }),
    ]);
    const rows = await db.select().from(workingHours).where(eq(workingHours.barberId, chane()));
    expect(rows).toHaveLength(1);
  });

  it("creating two services with the same name at once gives both a unique slug", async () => {
    const input = { name: "Kids cut", durationMinutes: 20, price: 10, sortOrder: 9, active: true };
    const ids = await Promise.all([saveService(db, input), saveService(db, input)]);
    const rows = await db.select().from(services).where(inArray(services.id, ids));
    expect(rows.map((r) => r.slug).sort()).toEqual(["kids-cut", "kids-cut-2"]);
  });

  it("keeps an inactive barber's offered services when saved again", async () => {
    await db.update(barbers).set({ active: false }).where(eq(barbers.id, chane()));
    await saveBarber(db, {
      id: chane(),
      name: "Chane",
      sortOrder: 1,
      active: false,
      serviceIds: [cut()],
    });
    const offered = await db
      .select()
      .from(barberServices)
      .where(eq(barberServices.barberId, chane()));
    expect(offered.map((o) => o.serviceId)).toEqual([cut()]);
  });
});
