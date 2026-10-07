import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { zonedDateTime } from "@/server/booking/availability";
import { createBooking } from "@/server/booking/create-booking";
import { SlotUnavailableError } from "@/server/booking/errors";
import { appointments } from "@/server/db/schema";

import { createTestDb, customer, resetDatabase } from "./test-db";

const { db, client } = createTestDb(5);
const MONDAY = "2030-06-03";
const now = new Date("2030-06-01T10:00:00Z");
const local = (time: string, date = MONDAY) => zonedDateTime(date, time, "Europe/Madrid");

let chane: string;
let leo: string;
let cut: string;
let cutAndBeard: string;

beforeEach(async () => {
  const seeded = await resetDatabase(db);
  chane = seeded.barbers.find((b) => b.slug === "chane")!.id;
  leo = seeded.barbers.find((b) => b.slug === "leo")!.id;
  cut = seeded.services.find((s) => s.slug === "classic-cut")!.id;
  cutAndBeard = seeded.services.find((s) => s.slug === "cut-and-beard")!.id;
});

afterAll(() => client.end());

const request = (overrides: Partial<Parameters<typeof createBooking>[1]> = {}) => ({
  ...customer,
  privacyAccepted: true as const,
  serviceId: cut,
  barberId: chane as string | null,
  startsAt: local("10:00"),
  ...overrides,
});

describe("createBooking", () => {
  it("books an offered slot with the service's duration and returns display names", async () => {
    const result = await createBooking(db, request({ serviceId: cutAndBeard }), { now });

    expect(result.appointment.endsAt).toEqual(local("10:45"));
    expect(result).toMatchObject({ barberName: "Chane", serviceName: "Cut + beard trim" });
    expect(result.manageToken).toBeTruthy();
  });

  it.each([
    ["outside opening hours", local("21:00")],
    ["during the lunch break", local("14:00")],
    ["running into the lunch break", local("13:15")],
    ["off the slot grid", local("10:05")],
    ["on a Sunday", local("10:00", "2030-06-09")],
    ["in the past", local("10:00", "2030-05-27")],
    ["beyond the booking horizon", local("10:00", "2030-09-02")],
  ])("rejects a start time %s", async (_, startsAt) => {
    await expect(createBooking(db, request({ startsAt }), { now })).rejects.toBeInstanceOf(
      SlotUnavailableError,
    );
    expect(await db.$count(appointments)).toBe(0);
  });

  it("rejects a slot the chosen barber already has, even if another barber is free", async () => {
    await createBooking(db, request(), { now });
    await expect(createBooking(db, request(), { now })).rejects.toBeInstanceOf(
      SlotUnavailableError,
    );
  });

  it("assigns the least busy free barber when there is no preference", async () => {
    await createBooking(db, request({ startsAt: local("17:00") }), { now });

    const result = await createBooking(db, request({ barberId: null }), { now });
    expect(result.appointment.barberId).toBe(leo);
  });

  it("returns the original booking when a request is retried with the same key", async () => {
    const idempotencyKey = randomUUID();
    const first = await createBooking(db, request(), { now, idempotencyKey });
    // The slot is now taken by this very booking, so a naive retry would get a 409.
    const retry = await createBooking(db, request(), { now, idempotencyKey });

    expect(retry).toMatchObject({ replayed: true, manageToken: null, barberName: "Chane" });
    expect(retry.appointment.id).toBe(first.appointment.id);
    expect(await db.$count(appointments)).toBe(1);
  });
});
