import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { zonedDateTime } from "@/server/booking/availability";
import { createBooking } from "@/server/booking/create-booking";
import { NotModifiableError, SlotUnavailableError } from "@/server/booking/errors";
import {
  cancelAppointment,
  findAppointmentByManageToken,
  markAppointmentOutcome,
  rescheduleAppointment,
} from "@/server/booking/manage-appointment";
import { appointmentEvents, appointments } from "@/server/db/schema";

import { createTestDb, customer, resetDatabase } from "./test-db";

const { db, client } = createTestDb(10);
const MONDAY = "2030-06-03";
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

async function book(time = "10:00", barberId: string = chane) {
  const result = await createBooking(
    db,
    {
      ...customer,
      serviceId: cut,
      barberId,
      startsAt: local(time),
    },
    { now },
  );
  return { id: result.appointment.id, token: result.manageToken! };
}

const eventsOf = (id: string) =>
  db.select().from(appointmentEvents).where(eq(appointmentEvents.appointmentId, id));

describe("findAppointmentByManageToken", () => {
  it("finds the appointment by its secret and reports whether it can be changed", async () => {
    const { id, token } = await book();
    const details = await findAppointmentByManageToken(db, token, now);

    expect(details).toMatchObject({ id, barberName: "Chane", serviceName: "Classic cut" });
    expect(details?.canModify).toBe(true);
    // 2 h cancellation cutoff from the seed.
    expect(details?.modifiableUntil).toEqual(local("08:00"));
  });

  it("returns undefined for unknown tokens", async () => {
    await book();
    expect(await findAppointmentByManageToken(db, "x".repeat(43), now)).toBeUndefined();
  });

  it("reports canModify = false inside the cutoff window", async () => {
    const { token } = await book();
    const details = await findAppointmentByManageToken(db, token, local("08:30"));
    expect(details?.canModify).toBe(false);
  });
});

describe("cancelAppointment", () => {
  it("cancels, frees the slot and records who did it", async () => {
    const { id } = await book();
    const result = await cancelAppointment(db, id, { actor: "customer", now });

    expect(result.status).toBe("cancelled");
    expect((await eventsOf(id)).map((e) => [e.type, e.actor])).toEqual([
      ["created", "customer"],
      ["cancelled", "customer"],
    ]);
    // Somebody else can now book that time.
    await expect(book("10:00")).resolves.toBeTruthy();
  });

  it("refuses customers inside the cutoff window, but not staff", async () => {
    const { id } = await book();
    const late = local("08:30");

    await expect(cancelAppointment(db, id, { actor: "customer", now: late })).rejects.toMatchObject(
      {
        reason: "too_late",
      },
    );
    await expect(cancelAppointment(db, id, { actor: "admin", now: late })).resolves.toMatchObject({
      status: "cancelled",
    });
  });

  it("cannot cancel twice", async () => {
    const { id } = await book();
    await cancelAppointment(db, id, { actor: "customer", now });
    await expect(cancelAppointment(db, id, { actor: "customer", now })).rejects.toMatchObject({
      reason: "not_confirmed",
    });
  });

  it("lets exactly one of two simultaneous cancellations win", async () => {
    const { id } = await book();
    const results = await Promise.allSettled([
      cancelAppointment(db, id, { actor: "customer", now }),
      cancelAppointment(db, id, { actor: "customer", now }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const cancelEvents = (await eventsOf(id)).filter((e) => e.type === "cancelled");
    expect(cancelEvents).toHaveLength(1);
  });
});

describe("rescheduleAppointment", () => {
  it("moves the appointment, keeps its duration and resets the reminder", async () => {
    const { id } = await book();
    await db.update(appointments).set({ reminderSentAt: now }).where(eq(appointments.id, id));

    const { after } = await rescheduleAppointment(db, id, {
      startsAt: local("17:00"),
      actor: "customer",
      now,
    });

    expect(after.startsAt).toEqual(local("17:00"));
    expect(after.endsAt).toEqual(local("17:30"));
    const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
    expect(row?.reminderSentAt).toBeNull();
    expect((await eventsOf(id)).at(-1)).toMatchObject({ type: "rescheduled", actor: "customer" });
  });

  it("can move by less than its own duration (its current time does not block it)", async () => {
    const { id } = await book("10:00");
    const { after } = await rescheduleAppointment(db, id, {
      startsAt: local("10:15"),
      actor: "customer",
      now,
    });
    expect(after.startsAt).toEqual(local("10:15"));
  });

  it("refuses a time taken by someone else", async () => {
    await book("11:00");
    const { id } = await book("10:00");

    await expect(
      rescheduleAppointment(db, id, { startsAt: local("11:15"), actor: "customer", now }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("refuses times outside the rules, such as Sunday", async () => {
    const { id } = await book();
    await expect(
      rescheduleAppointment(db, id, {
        startsAt: local("10:00", "2030-06-09"),
        actor: "customer",
        now,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });

  it("ignores a barber change requested by a customer, allows it for staff", async () => {
    const { id } = await book();

    const asCustomer = await rescheduleAppointment(db, id, {
      startsAt: local("12:00"),
      barberId: leo,
      actor: "customer",
      now,
    });
    expect(asCustomer.after.barberId).toBe(chane);

    const asAdmin = await rescheduleAppointment(db, id, {
      startsAt: local("12:00"),
      barberId: leo,
      actor: "admin",
      now,
    });
    expect(asAdmin.after.barberId).toBe(leo);
  });

  it("two customers moving into the same free time: exactly one succeeds", async () => {
    const first = await book("10:00");
    const second = await book("11:00");

    const results = await Promise.allSettled([
      rescheduleAppointment(db, first.id, { startsAt: local("17:00"), actor: "customer", now }),
      rescheduleAppointment(db, second.id, { startsAt: local("17:00"), actor: "customer", now }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(SlotUnavailableError);
  });

  it("a cancellation racing a reschedule never leaves a moved-but-cancelled mess", async () => {
    const { id } = await book();

    await Promise.allSettled([
      cancelAppointment(db, id, { actor: "customer", now }),
      rescheduleAppointment(db, id, { startsAt: local("17:00"), actor: "customer", now }),
    ]);

    const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
    const types = (await eventsOf(id)).map((e) => e.type).filter((t) => t !== "created");
    // Either it was cancelled at its original time, or moved and still confirmed
    // (and possibly cancelled afterwards), but the history must match the row.
    if (row?.status === "cancelled") {
      expect(types.at(-1)).toBe("cancelled");
    } else {
      expect(row?.startsAt).toEqual(local("17:00"));
      expect(types).toEqual(["rescheduled"]);
    }
  });
});

describe("markAppointmentOutcome", () => {
  it("marks completed or no-show only after the start", async () => {
    const { id } = await book();
    await expect(
      markAppointmentOutcome(db, id, { outcome: "completed", now }),
    ).rejects.toBeInstanceOf(NotModifiableError);

    await markAppointmentOutcome(db, id, { outcome: "no_show", now: local("10:20") });
    const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
    expect(row?.status).toBe("no_show");
  });
});
