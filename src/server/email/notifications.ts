import { and, count, eq, gte, isNull, lt } from "drizzle-orm";

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

/** Calendar SEQUENCE: 0 when booked, +1 for every reschedule, +1 more when cancelled. */
async function calendarSequence(db: Db, appointmentId: string, kind: Kind) {
  const [row] = await db
    .select({ n: count() })
    .from(appointmentEvents)
    .where(
      and(
        eq(appointmentEvents.appointmentId, appointmentId),
        eq(appointmentEvents.type, "rescheduled"),
      ),
    );
  return (row?.n ?? 0) + (kind === "cancelled" ? 1 : 0);
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
  const actionUrl = kind === "cancelled" ? `${appUrl()}/book` : manageUrl;

  const rendered = await renderAppointmentEmail({
    kind,
    appointment: details,
    shop: { name: shop.name, phone: shop.phone, address: shop.address, timezone: shop.timezone },
    actionUrl,
    previousStartsAt,
    cancellationCutoffMinutes: shop.cancellationCutoffMinutes,
  });

  const ics = buildIcs(
    {
      uid: `${details.id}@barber-booking`,
      sequence: await calendarSequence(db, details.id, kind),
      startsAt: details.startsAt,
      endsAt: details.endsAt,
      summary: `${details.serviceName} · ${shop.name}`,
      description: `With ${details.barberName}.${kind === "cancelled" ? "" : `\nManage: ${manageUrl}`}`,
      location: shop.address ?? shop.name,
      url: kind === "cancelled" ? undefined : manageUrl,
      organizer: { name: shop.name, email: senderAddress() },
      status: kind === "cancelled" ? "cancelled" : "confirmed",
    },
    { now },
  );

  return {
    to: details.customerEmail,
    ...rendered,
    attachments: [
      {
        filename: kind === "cancelled" ? "cancelled-appointment.ics" : "appointment.ics",
        content: ics,
        contentType: `text/calendar; charset=utf-8; method=${kind === "cancelled" ? "CANCEL" : "PUBLISH"}`,
      },
    ],
    // One email per appointment, kind and appointment time: retries never duplicate it.
    idempotencyKey: `${details.id}:${kind}:${details.startsAt.getTime()}`,
  };
}

async function send(db: Db, appointmentId: string, kind: Kind, previousStartsAt?: Date) {
  try {
    const details = await getAppointmentDetails(db, appointmentId);
    if (!details) return false;
    const message = await buildAppointmentEmail(db, details, kind, { previousStartsAt });
    await getEmailTransport().send(message);
    return true;
  } catch (error) {
    console.error(`[email] failed to send "${kind}" for appointment ${appointmentId}`, error);
    return false;
  }
}

export const notifyBookingConfirmed = (db: Db, appointmentId: string) =>
  send(db, appointmentId, "confirmed");

export const notifyRescheduled = (db: Db, appointmentId: string, previousStartsAt: Date) =>
  send(db, appointmentId, "rescheduled", previousStartsAt);

export const notifyCancelled = (db: Db, appointmentId: string) =>
  send(db, appointmentId, "cancelled");

/**
 * Sends the day-before reminder for every confirmed appointment tomorrow
 * (shop-local) that has not been reminded yet. Runs from a daily cron.
 *
 * Each appointment is claimed first with a conditional UPDATE, so two
 * overlapping cron runs can never remind the same customer twice. If the
 * email then fails, the claim is released so a later run can retry.
 */
export async function sendDueReminders(db: Db, now = new Date()) {
  const shop = await loadShop(db);
  const tomorrow = dayBounds(addDays(localDate(now, shop.timezone), 1), shop.timezone);

  const claimed = await db
    .update(appointments)
    .set({ reminderSentAt: now })
    .where(
      and(
        eq(appointments.status, "confirmed"),
        isNull(appointments.reminderSentAt),
        gte(appointments.startsAt, tomorrow.start),
        lt(appointments.startsAt, tomorrow.end),
      ),
    )
    .returning({ id: appointments.id });

  let sent = 0;
  for (const { id } of claimed) {
    if (await send(db, id, "reminder")) {
      sent++;
      await db
        .insert(appointmentEvents)
        .values({ appointmentId: id, type: "reminder_sent", actor: "system" });
    } else {
      await db.update(appointments).set({ reminderSentAt: null }).where(eq(appointments.id, id));
    }
  }
  return { due: claimed.length, sent, failed: claimed.length - sent };
}
