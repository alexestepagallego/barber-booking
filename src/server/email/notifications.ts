import { and, eq, gte, isNull, lt, ne } from "drizzle-orm";

import { addDays } from "@/lib/calendar";
import { buildIcs } from "@/lib/ics";
import { dayBounds, localDate } from "@/server/booking/availability";
import {
  getAppointmentDetails,
  type AppointmentDetails,
} from "@/server/booking/manage-appointment";
import { appUrl, emailFrom } from "@/server/config";
import type { Db } from "@/server/db/client";
import { appointmentEvents, appointments, shopSettings } from "@/server/db/schema";
import { describeError } from "@/server/log";
import { deriveManageToken } from "@/server/security/tokens";

import { renderAppointmentEmail, type EmailProps } from "./templates";
import { getEmailTransport } from "./transport";

/**
 * High-level "tell the customer" functions. They are called after the
 * response has been sent (Next.js `after()`), so a slow or failing email
 * provider never delays or breaks a booking. Failures are logged without
 * personal data and do not throw.
 */

type Kind = EmailProps["kind"];

async function loadShop(db: Db) {
  const [shop] = await db.select().from(shopSettings).where(eq(shopSettings.id, 1));
  if (!shop) throw new Error("Shop settings are missing");
  return shop;
}

function senderAddress(): string {
  const match = /<([^>]+)>/.exec(emailFrom());
  return match?.[1] ?? emailFrom();
}

export async function buildAppointmentEmail(
  db: Db,
  details: AppointmentDetails,
  kind: Kind,
  { previousStartsAt, now = new Date() }: { previousStartsAt?: Date; now?: Date } = {},
) {
  const shop = await loadShop(db);
  const manageUrl = `${appUrl()}/manage/${deriveManageToken(details.id)}`;
  const cancelled = kind === "cancelled";
  const today = localDate(now, shop.timezone);
  const day = localDate(details.startsAt, shop.timezone);

  const rendered = await renderAppointmentEmail({
    kind,
    appointment: details,
    shop: { name: shop.name, phone: shop.phone, address: shop.address, timezone: shop.timezone },
    actionUrl: cancelled ? `${appUrl()}/book` : manageUrl,
    previousStartsAt,
    cancellationCutoffMinutes: shop.cancellationCutoffMinutes,
    // Whether the "change or cancel online" offer is still true when the email is read.
    canModify: details.canModify,
    relativeDay: day === today ? "today" : day === addDays(today, 1) ? "tomorrow" : undefined,
  });

  const ics = buildIcs(
    {
      uid: `${details.id}@barber-booking`,
      sequence: details.calendarSequence,
      startsAt: details.startsAt,
      endsAt: details.endsAt,
      summary: `${details.serviceName} · ${shop.name}`,
      description: `With ${details.barberName}.${cancelled ? "" : `\nManage: ${manageUrl}`}`,
      location: shop.address ?? shop.name,
      url: cancelled ? undefined : manageUrl,
      organizer: { name: shop.name, email: senderAddress() },
      status: cancelled ? "cancelled" : "confirmed",
    },
    { now },
  );

  return {
    to: details.customerEmail,
    ...rendered,
    attachments: [
      {
        filename: cancelled ? "cancelled-appointment.ics" : "appointment.ics",
        content: ics,
        contentType: `text/calendar; charset=utf-8; method=${cancelled ? "CANCEL" : "PUBLISH"}`,
      },
    ],
    // Unique per email kind and version of the appointment: a provider retry
    // is deduplicated, while every real change (even back to an earlier
    // time) gets its own email.
    idempotencyKey: `${details.id}:${kind}:${details.calendarSequence}`,
  };
}

async function send(
  db: Db,
  appointmentId: string,
  kind: Kind,
  { previousStartsAt, now }: { previousStartsAt?: Date; now?: Date } = {},
) {
  try {
    const details = await getAppointmentDetails(db, appointmentId, now);
    // Walk-ins booked by staff may have no email address.
    if (!details?.customerEmail) return false;
    const message = await buildAppointmentEmail(db, details, kind, { previousStartsAt, now });
    await getEmailTransport().send(message);
    return true;
  } catch (error) {
    console.error(
      `[email] "${kind}" for appointment ${appointmentId} failed`,
      describeError(error),
    );
    return false;
  }
}

export const notifyBookingConfirmed = (db: Db, appointmentId: string) =>
  send(db, appointmentId, "confirmed");

export const notifyRescheduled = (db: Db, appointmentId: string, previousStartsAt: Date) =>
  send(db, appointmentId, "rescheduled", { previousStartsAt });

export const notifyCancelled = (db: Db, appointmentId: string) =>
  send(db, appointmentId, "cancelled");

/** Leave headroom below the cron route's maxDuration (60 s). */
const REMINDER_TIME_BUDGET_MS = 40_000;
const REMINDER_CONCURRENCY = 4;
/** No point reminding someone whose appointment starts within the hour. */
const REMINDER_MIN_LEAD_MS = 60 * 60 * 1000;

/**
 * Sends reminders for confirmed appointments from one hour from now until
 * the end of tomorrow (shop-local) that have not been reminded yet. Runs
 * from a daily cron; because the window also covers the rest of today,
 * an appointment whose reminder failed yesterday is retried on the next
 * run, as long as it has not started yet.
 *
 * Each appointment is claimed with its own conditional UPDATE immediately
 * before its email is built, re-checking that it is still confirmed at the
 * same time. Two overlapping runs can therefore never remind the same
 * customer twice, a cancellation just before the claim is respected, and a
 * failed send releases the claim for the next run. Work stops before the
 * time budget runs out; whatever is left stays unclaimed for the next run.
 */
export async function sendDueReminders(db: Db, now = new Date()) {
  const startedAt = Date.now();
  const shop = await loadShop(db);
  const endOfTomorrow = dayBounds(addDays(localDate(now, shop.timezone), 1), shop.timezone).end;

  const due = await db
    .select({ id: appointments.id, startsAt: appointments.startsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.status, "confirmed"),
        isNull(appointments.reminderSentAt),
        ne(appointments.customerEmail, ""),
        gte(appointments.startsAt, new Date(now.getTime() + REMINDER_MIN_LEAD_MS)),
        lt(appointments.startsAt, endOfTomorrow),
      ),
    )
    .orderBy(appointments.startsAt);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const queue = [...due];

  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (Date.now() - startedAt > REMINDER_TIME_BUDGET_MS) {
        skipped++;
        continue;
      }
      const [claimed] = await db
        .update(appointments)
        .set({ reminderSentAt: now })
        .where(
          and(
            eq(appointments.id, next.id),
            eq(appointments.status, "confirmed"),
            isNull(appointments.reminderSentAt),
            eq(appointments.startsAt, next.startsAt),
          ),
        )
        .returning({ id: appointments.id });
      if (!claimed) {
        skipped++; // cancelled, moved or claimed by another run meanwhile
        continue;
      }

      if (await send(db, next.id, "reminder", { now })) {
        sent++;
        await db
          .insert(appointmentEvents)
          .values({ appointmentId: next.id, type: "reminder_sent", actor: "system" });
      } else {
        failed++;
        await db
          .update(appointments)
          .set({ reminderSentAt: null })
          .where(and(eq(appointments.id, next.id), eq(appointments.reminderSentAt, now)));
      }
    }
  }

  await Promise.all(Array.from({ length: REMINDER_CONCURRENCY }, worker));
  return { due: due.length, sent, failed, skipped };
}
