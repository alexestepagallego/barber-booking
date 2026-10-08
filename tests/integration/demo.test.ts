import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdminUser, verifyCredentials } from "@/server/admin/auth";
import { zonedDateTime } from "@/server/booking/availability";
import { createBooking } from "@/server/booking/create-booking";
import { adminUsers, appointments, barbers, services } from "@/server/db/schema";
import { resetDemo } from "@/server/demo";

import { createTestDb, customer, resetDatabase } from "./test-db";

const { db, client } = createTestDb(5);
const now = new Date("2030-06-03T07:00:00Z"); // Monday 09:00 in Madrid
const DEMO = { email: "demo@example.com", password: "demo password 1234" };

let seeded: Awaited<ReturnType<typeof resetDatabase>>;

beforeEach(async () => {
  seeded = await resetDatabase(db);
  process.env.DEMO_ADMIN_EMAIL = DEMO.email;
  process.env.DEMO_ADMIN_PASSWORD = DEMO.password;
});

afterEach(() => {
  delete process.env.DEMO_ADMIN_EMAIL;
  delete process.env.DEMO_ADMIN_PASSWORD;
});

afterAll(() => client.end());

describe("resetDemo", () => {
  it("wipes visitors' changes and restores the same catalogue ids", async () => {
    await createBooking(
      db,
      {
        ...customer,
        serviceId: seeded.services[0]!.id,
        barberId: seeded.barbers[0]!.id,
        startsAt: zonedDateTime("2030-06-04", "10:00", "Europe/Madrid"),
      },
      { now },
    );
    await createAdminUser(db, { email: "visitor@example.com", name: "V", password: DEMO.password });
    await db.update(services).set({ priceCents: 1, active: false });
    await db.update(barbers).set({ active: false });

    await resetDemo(db, now);

    const restored = await db.select().from(services);
    expect(restored.every((s) => s.active && s.priceCents > 1)).toBe(true);
    expect(restored.map((s) => s.id).sort()).toEqual(seeded.services.map((s) => s.id).sort());
    expect((await db.select().from(barbers)).every((b) => b.active)).toBe(true);

    const visitorBookings = await db
      .select()
      .from(appointments)
      .where(sql`${appointments.customerEmail} = ${customer.customerEmail}`);
    expect(visitorBookings).toEqual([]);
  });

  it("leaves the demo admin as the only account", async () => {
    await createAdminUser(db, { email: "visitor@example.com", name: "V", password: DEMO.password });
    await resetDemo(db, now);

    expect((await db.select().from(adminUsers)).map((u) => u.email)).toEqual([DEMO.email]);
    expect(await verifyCredentials(db, DEMO.email, DEMO.password)).toBeTruthy();
  });

  it("fills the coming days with sample bookings that never overlap and never email anyone", async () => {
    const { sampleAppointments } = await resetDemo(db, now);
    expect(sampleAppointments).toBeGreaterThan(10);

    const rows = await db.select().from(appointments);
    expect(rows).toHaveLength(sampleAppointments);
    expect(rows.every((a) => a.customerEmail === "" && a.status === "confirmed")).toBe(true);
    expect(rows.every((a) => a.startsAt >= now)).toBe(true);
  });

  it("is deterministic for a given day", async () => {
    const first = await resetDemo(db, now);
    const second = await resetDemo(db, now);
    expect(second.sampleAppointments).toBe(first.sampleAppointments);
  });
});
