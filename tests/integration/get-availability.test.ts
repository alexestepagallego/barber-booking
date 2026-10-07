import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { insertAppointment } from "@/server/booking/appointments-repository";
import { zonedDateTime } from "@/server/booking/availability";
import { NotFoundError } from "@/server/booking/errors";
import { getAvailability } from "@/server/booking/get-availability";
import { appointments, barberServices, barbers, services, timeOff } from "@/server/db/schema";

import { createTestDb, customer, resetDatabase } from "./test-db";

const { db, client } = createTestDb(5);
const MONDAY = "2030-06-03";
const SUNDAY = "2030-06-09";
const now = new Date("2030-06-01T10:00:00Z");
const local = (time: string, date = MONDAY) => zonedDateTime(date, time, "Europe/Madrid");

let chane: string;
let leo: string;
let cut: string;

beforeEach(async () => {
  const seeded = await resetDatabase(db);
  chane = seeded.barbers.find((b) => b.slug === "chane")!.id;
  leo = seeded.barbers.find((b) => b.slug === "leo")!.id;
  cut = seeded.services.find((s) => s.slug === "classic-cut")!.id;
});

afterAll(() => client.end());

const startsAt = (slots: { startsAt: Date }[]) => slots.map((s) => s.startsAt.getTime());

describe("getAvailability", () => {
  it("offers the seeded split-shift schedule on a weekday", async () => {
    const slots = await getAvailability(db, { date: MONDAY, serviceId: cut, barberId: chane, now });

    expect(slots[0]?.startsAt).toEqual(local("09:00"));
    expect(slots.at(-1)?.startsAt).toEqual(local("19:30"));
    expect(slots.every((s) => s.barberIds.length === 1 && s.barberIds[0] === chane)).toBe(true);
  });

  it("is closed on Sunday", async () => {
    expect(await getAvailability(db, { date: SUNDAY, serviceId: cut, now })).toEqual([]);
  });

  it("hides times taken by a confirmed appointment, only for that barber", async () => {
    await insertAppointment(db, {
      ...customer,
      barberId: chane,
      serviceId: cut,
      startsAt: local("10:00"),
      endsAt: local("10:30"),
      actor: "customer",
    });

    const chaneSlots = await getAvailability(db, {
      date: MONDAY,
      serviceId: cut,
      barberId: chane,
      now,
    });
    expect(startsAt(chaneSlots)).not.toContain(local("10:00").getTime());

    const anySlots = await getAvailability(db, { date: MONDAY, serviceId: cut, now });
    const tenOClock = anySlots.find((s) => s.startsAt.getTime() === local("10:00").getTime());
    expect(tenOClock?.barberIds).toEqual([leo]);
  });

  it("suggests the least busy barber first for 'no preference'", async () => {
    await insertAppointment(db, {
      ...customer,
      barberId: chane,
      serviceId: cut,
      startsAt: local("17:00"),
      endsAt: local("17:30"),
      actor: "customer",
    });

    const [first] = await getAvailability(db, { date: MONDAY, serviceId: cut, now });
    expect(first?.barberIds).toEqual([leo, chane]);
  });

  it("applies shop-wide closures and personal time off", async () => {
    await db.insert(timeOff).values([
      { barberId: null, startsAt: local("09:00"), endsAt: local("13:30"), reason: "Holiday" },
      { barberId: leo, startsAt: local("16:00"), endsAt: local("20:00"), reason: "Vacation" },
    ]);

    const slots = await getAvailability(db, { date: MONDAY, serviceId: cut, now });
    expect(slots[0]?.startsAt).toEqual(local("16:00"));
    expect(slots.every((s) => s.barberIds.length === 1 && s.barberIds[0] === chane)).toBe(true);
  });

  it("ignores cancelled appointments", async () => {
    const { appointment } = await insertAppointment(db, {
      ...customer,
      barberId: chane,
      serviceId: cut,
      startsAt: local("09:00"),
      endsAt: local("09:30"),
      actor: "customer",
    });
    await db
      .update(appointments)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(appointments.id, appointment.id));

    const slots = await getAvailability(db, { date: MONDAY, serviceId: cut, barberId: chane, now });
    expect(slots[0]?.startsAt).toEqual(local("09:00"));
  });

  it("excludes inactive barbers and barbers who do not offer the service", async () => {
    await db.update(barbers).set({ active: false }).where(eq(barbers.id, leo));
    let slots = await getAvailability(db, { date: MONDAY, serviceId: cut, now });
    expect(slots.flatMap((s) => s.barberIds)).not.toContain(leo);

    await db.update(barbers).set({ active: true }).where(eq(barbers.id, leo));
    await db.delete(barberServices).where(eq(barberServices.barberId, chane));
    slots = await getAvailability(db, { date: MONDAY, serviceId: cut, now });
    expect(slots.flatMap((s) => s.barberIds)).not.toContain(chane);
  });

  it("rejects unknown or inactive services and barbers", async () => {
    const unknown = "00000000-0000-0000-0000-000000000000";
    await expect(getAvailability(db, { date: MONDAY, serviceId: unknown, now })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      getAvailability(db, { date: MONDAY, serviceId: cut, barberId: unknown, now }),
    ).rejects.toThrow(NotFoundError);

    await db.update(services).set({ active: false }).where(eq(services.id, cut));
    await expect(getAvailability(db, { date: MONDAY, serviceId: cut, now })).rejects.toThrow(
      NotFoundError,
    );
  });
});
