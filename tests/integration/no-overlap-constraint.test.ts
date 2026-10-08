import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { insertAppointment } from "@/server/booking/appointments-repository";
import { SlotUnavailableError } from "@/server/booking/errors";
import { appointmentEvents, appointments } from "@/server/db/schema";
import { hashToken } from "@/server/security/tokens";

import { addMinutes, at, createTestDb, customer, resetDatabase } from "./test-db";

const { db, client } = createTestDb(5);
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

function book(
  barberId: string,
  start: Date,
  minutes = 30,
  extra: { idempotencyKey?: string } = {},
) {
  return insertAppointment(db, {
    ...customer,
    ...extra,
    barberId,
    serviceId: cut,
    startsAt: start,
    endsAt: addMinutes(start, minutes),
    actor: "customer",
  });
}

describe("appointments_no_overlap constraint", () => {
  it("rejects an appointment that partially overlaps another one of the same barber", async () => {
    await book(chane, at("10:00"));

    await expect(book(chane, at("10:15"))).rejects.toBeInstanceOf(SlotUnavailableError);
    await expect(book(chane, at("09:45"))).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("rejects an appointment fully contained in another one", async () => {
    await book(chane, at("10:00"), 45);

    await expect(book(chane, at("10:15"), 15)).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("allows back-to-back appointments because ranges are half-open", async () => {
    await book(chane, at("10:00"));
    await book(chane, at("10:30"));
    await book(chane, at("09:30"));

    const rows = await db.select().from(appointments).where(eq(appointments.barberId, chane));
    expect(rows).toHaveLength(3);
  });

  it("allows different barbers to be booked at the same time", async () => {
    await book(chane, at("10:00"));
    await book(leo, at("10:00"));

    expect(await db.$count(appointments)).toBe(2);
  });

  it("frees the slot when an appointment is cancelled", async () => {
    const { appointment } = await book(chane, at("10:00"));
    await db
      .update(appointments)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(appointments.id, appointment.id));

    await expect(book(chane, at("10:00"))).resolves.toMatchObject({ replayed: false });
  });

  it("also protects updates: re-confirming a cancelled appointment whose slot was taken fails", async () => {
    const { appointment } = await book(chane, at("10:00"));
    await db
      .update(appointments)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(appointments.id, appointment.id));
    await book(chane, at("10:00"));

    await expect(
      db
        .update(appointments)
        .set({ status: "confirmed", cancelledAt: null })
        .where(eq(appointments.id, appointment.id)),
    ).rejects.toMatchObject({ cause: { code: "23P01" } });
  });

  it("rejects an appointment that ends before it starts", async () => {
    await expect(book(chane, at("10:00"), -30)).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("insertAppointment", () => {
  it("stores only the hash of the manage token and records a 'created' event", async () => {
    const { appointment, manageToken } = await book(chane, at("10:00"));

    expect(manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(appointment.manageTokenHash).toBe(hashToken(manageToken!));
    expect(appointment.manageTokenHash).not.toContain(manageToken);

    const events = await db
      .select()
      .from(appointmentEvents)
      .where(eq(appointmentEvents.appointmentId, appointment.id));
    expect(events).toMatchObject([{ type: "created", actor: "customer" }]);
  });

  it("is idempotent: retrying with the same key returns the original appointment", async () => {
    const idempotencyKey = randomUUID();
    const first = await book(chane, at("10:00"), 30, { idempotencyKey });
    const retry = await book(chane, at("10:00"), 30, { idempotencyKey });

    expect(first.replayed).toBe(false);
    expect(retry).toMatchObject({ replayed: true, manageToken: first.manageToken });
    expect(retry.appointment.id).toBe(first.appointment.id);
    expect(await db.$count(appointments)).toBe(1);
  });
});
