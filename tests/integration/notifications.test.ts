import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { zonedDateTime } from "@/server/booking/availability";
import { createBooking } from "@/server/booking/create-booking";
import { cancelAppointment, rescheduleAppointment } from "@/server/booking/manage-appointment";
import { appointmentEvents, appointments } from "@/server/db/schema";
import {
  notifyBookingConfirmed,
  notifyCancelled,
  notifyRescheduled,
  sendDueReminders,
} from "@/server/email/notifications";
import { memoryTransport, setEmailTransport, type EmailTransport } from "@/server/email/transport";
import { ERASED_EMAIL, erasePersonalData } from "@/server/maintenance";
import { deriveManageToken } from "@/server/security/tokens";

import { createTestDb, customer, resetDatabase } from "./test-db";

const { db, client } = createTestDb(5);
const MONDAY = "2030-06-03";
const now = new Date("2030-06-01T10:00:00Z");
const local = (time: string, date = MONDAY) => zonedDateTime(date, time, "Europe/Madrid");

let mail: ReturnType<typeof memoryTransport>;
let cut: string;
let chane: string;

beforeEach(async () => {
  const seeded = await resetDatabase(db);
  cut = seeded.services.find((s) => s.slug === "classic-cut")!.id;
  chane = seeded.barbers.find((b) => b.slug === "chane")!.id;
  mail = memoryTransport();
  setEmailTransport(mail);
});

afterEach(() => setEmailTransport(undefined));
afterAll(() => client.end());

async function book(time = "10:00", date = MONDAY) {
  const result = await createBooking(
    db,
    {
      ...customer,
      serviceId: cut,
      barberId: chane,
      startsAt: local(time, date),
    },
    { now },
  );
  return result.appointment.id;
}

const icsOf = (index = 0) => mail.outbox[index]!.attachments![0]!.content;

describe("appointment emails", () => {
  it("confirmation: details, a working manage link and a calendar invite", async () => {
    const id = await book();
    expect(await notifyBookingConfirmed(db, id)).toBe(true);

    const [email] = mail.outbox;
    expect(email).toMatchObject({
      to: customer.customerEmail,
      subject: "Your appointment at Chane Barber is confirmed",
    });
    expect(email!.html).toContain("Classic cut");
    expect(email!.html).toContain("Chane");
    expect(email!.html).toContain(`/manage/${deriveManageToken(id)}`);
    expect(email!.text).toContain("Monday 3 June");
    expect(icsOf()).toContain(`UID:${id}@barber-booking`);
    expect(icsOf()).toContain("SEQUENCE:0");
    expect(icsOf()).toContain("METHOD:PUBLISH");
  });

  it("reschedule: shows the old time and bumps the calendar sequence", async () => {
    const id = await book();
    await rescheduleAppointment(db, id, { startsAt: local("17:00"), actor: "customer", now });
    await notifyRescheduled(db, id, local("10:00"));

    const [email] = mail.outbox;
    expect(email!.subject).toBe("Your appointment at Chane Barber has moved");
    expect(email!.text).toContain("10:00");
    expect(email!.text).toContain("17:00");
    expect(icsOf()).toContain("SEQUENCE:1");
    expect(icsOf()).toContain("DTSTART:20300603T150000Z");
  });

  it("cancellation: sends a CANCEL invite and links to booking again", async () => {
    const id = await book();
    await cancelAppointment(db, id, { actor: "customer", now });
    await notifyCancelled(db, id);

    const [email] = mail.outbox;
    expect(email!.subject).toBe("Your appointment at Chane Barber was cancelled");
    expect(email!.html).toContain("/book");
    expect(email!.html).not.toContain("/manage/");
    expect(icsOf()).toContain("METHOD:CANCEL");
    expect(icsOf()).toContain("STATUS:CANCELLED");
  });

  it("gives every email an idempotency key, so provider retries never duplicate it", async () => {
    const id = await book();
    await notifyBookingConfirmed(db, id);
    expect(mail.outbox[0]!.idempotencyKey).toBe(`${id}:confirmed:0`);
  });

  it("never throws when the provider fails: the booking is already safe", async () => {
    const id = await book();
    const failing: EmailTransport = {
      name: "failing",
      send: async () => {
        throw new Error("provider down");
      },
    };
    setEmailTransport(failing);
    await expect(notifyBookingConfirmed(db, id)).resolves.toBe(false);
  });
});

describe("sendDueReminders", () => {
  // The day before Monday 3 June, after the reminder run.
  const sundayEvening = local("18:00", "2030-06-02");

  it("reminds tomorrow's appointments exactly once", async () => {
    const tomorrow = await book("10:00");
    await book("10:00", "2030-06-04"); // the day after tomorrow: not yet

    expect(await sendDueReminders(db, sundayEvening)).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(mail.outbox).toHaveLength(1);
    expect(mail.outbox[0]!.subject).toBe("See you tomorrow at Chane Barber");

    // A second (or overlapping) run finds nothing to do.
    expect(await sendDueReminders(db, sundayEvening)).toMatchObject({ due: 0, sent: 0, failed: 0 });
    const events = await db
      .select()
      .from(appointmentEvents)
      .where(eq(appointmentEvents.appointmentId, tomorrow));
    expect(events.filter((e) => e.type === "reminder_sent")).toHaveLength(1);
  });

  it("skips cancelled appointments", async () => {
    const id = await book();
    await cancelAppointment(db, id, { actor: "customer", now });
    expect((await sendDueReminders(db, sundayEvening)).due).toBe(0);
  });

  it("releases the claim when the email fails, so a later run retries", async () => {
    const id = await book();
    setEmailTransport({
      name: "failing",
      send: async () => {
        throw new Error("provider down");
      },
    });

    expect(await sendDueReminders(db, sundayEvening)).toMatchObject({ due: 1, sent: 0, failed: 1 });
    const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
    expect(row?.reminderSentAt).toBeNull();
  });

  it("two overlapping runs never remind the same customer twice", async () => {
    await book("10:00");
    await book("11:00");
    const [a, b] = await Promise.all([
      sendDueReminders(db, sundayEvening),
      sendDueReminders(db, sundayEvening),
    ]);
    expect(a.sent + b.sent).toBe(2);
    expect(mail.outbox).toHaveLength(2);
  });
});

describe("erasePersonalData", () => {
  it("erases customer details only after the retention period", async () => {
    const id = await book();
    const justAfter = local("12:00");
    expect((await erasePersonalData(db, justAfter)).erased).toBe(0);

    const muchLater = new Date(local("12:00").getTime() + 400 * 24 * 60 * 60 * 1000);
    expect((await erasePersonalData(db, muchLater)).erased).toBe(1);

    const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
    expect(row).toMatchObject({
      customerName: "Erased",
      customerEmail: ERASED_EMAIL,
      customerPhone: "",
    });
    // Running again does not touch already-erased rows.
    expect((await erasePersonalData(db, muchLater)).erased).toBe(0);
  });
});
