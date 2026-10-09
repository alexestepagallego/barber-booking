import { and, eq, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { isConstraintViolation, PG_ERROR } from "@/server/db/errors";
import { withTransactionRetry } from "@/server/db/retry";
import {
  appointmentEvents,
  appointments,
  barbers,
  services,
  shopSettings,
  type Appointment,
} from "@/server/db/schema";
import { hashToken } from "@/server/security/tokens";

import { NO_OVERLAP_CONSTRAINT } from "./appointments-repository";
import { localDate } from "./availability";
import { NotFoundError, NotModifiableError, SlotUnavailableError } from "./errors";
import { getAvailability } from "./get-availability";
import { lockBarberSchedule } from "./schedule-lock";

const MINUTE = 60_000;

export type Actor = "customer" | "admin" | "system";

export type AppointmentDetails = {
  id: string;
  status: Appointment["status"];
  startsAt: Date;
  endsAt: Date;
  barberId: string;
  barberName: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  priceCents: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  timezone: string;
  /** Last moment a customer may cancel or reschedule online. */
  modifiableUntil: Date;
  /** True when a customer can still cancel or reschedule right now. */
  canModify: boolean;
  /**
   * iCalendar SEQUENCE of the latest version of this appointment: one more
   * per reschedule, plus one when cancelled. Every invite (emails and the
   * "Add to calendar" download) uses it, so calendar apps apply updates.
   */
  calendarSequence: number;
};

async function loadDetails(
  db: Db,
  where: { id: string } | { tokenHash: string },
  now: Date,
): Promise<AppointmentDetails | undefined> {
  const [row] = await db
    .select({
      appointment: appointments,
      barberName: barbers.name,
      serviceName: services.name,
      timezone: shopSettings.timezone,
      cutoff: shopSettings.cancellationCutoffMinutes,
      reschedules: sql<number>`(
        SELECT count(*)::int FROM ${appointmentEvents}
        WHERE ${appointmentEvents.appointmentId} = ${appointments.id}
          AND ${appointmentEvents.type} = 'rescheduled'
      )`,
    })
    .from(appointments)
    .innerJoin(barbers, eq(barbers.id, appointments.barberId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(shopSettings, eq(shopSettings.id, 1))
    .where(
      "id" in where
        ? eq(appointments.id, where.id)
        : eq(appointments.manageTokenHash, where.tokenHash),
    );
  if (!row) return undefined;

  const { appointment: a } = row;
  const modifiableUntil = new Date(a.startsAt.getTime() - row.cutoff * MINUTE);
  return {
    id: a.id,
    status: a.status,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    barberId: a.barberId,
    barberName: row.barberName,
    serviceId: a.serviceId,
    serviceName: row.serviceName,
    // The appointment's own length and price: later edits to the service
    // never change what this customer booked.
    durationMinutes: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / MINUTE),
    priceCents: a.priceCents,
    customerName: a.customerName,
    customerEmail: a.customerEmail,
    customerPhone: a.customerPhone,
    timezone: row.timezone,
    modifiableUntil,
    canModify: a.status === "confirmed" && now < modifiableUntil,
    calendarSequence: row.reschedules + (a.status === "cancelled" ? 1 : 0),
  };
}

export function getAppointmentDetails(db: Db, id: string, now = new Date()) {
  return loadDetails(db, { id }, now);
}

/**
 * Looks an appointment up by the secret from its manage link. The token is
 * hashed first, because only hashes are stored. Unknown tokens simply return
 * undefined: callers answer 404 without saying whether anything exists.
 */
export function findAppointmentByManageToken(db: Db, token: string, now = new Date()) {
  return loadDetails(db, { tokenHash: hashToken(token) }, now);
}

/** Why a customer can no longer change this appointment. */
function assertModifiable(details: AppointmentDetails, actor: Actor, now: Date) {
  if (details.status !== "confirmed") throw new NotModifiableError("not_confirmed");
  if (details.startsAt <= now) throw new NotModifiableError("past");
  if (actor === "customer" && now >= details.modifiableUntil) {
    throw new NotModifiableError("too_late");
  }
}

/**
 * Cancels a confirmed appointment and frees its time.
 *
 * The UPDATE repeats the preconditions in its WHERE clause, so two
 * concurrent cancellations (or a cancellation racing a reschedule) cannot
 * both win: whoever runs second matches zero rows and gets a clear error.
 */
export async function cancelAppointment(
  db: Db,
  id: string,
  { actor, now = new Date() }: { actor: Actor; now?: Date },
): Promise<AppointmentDetails> {
  const details = await getAppointmentDetails(db, id, now);
  if (!details) throw new NotFoundError("Appointment not found");
  assertModifiable(details, actor, now);

  const cancelled = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(appointments)
      .set({ status: "cancelled", cancelledAt: now })
      .where(
        and(
          eq(appointments.id, id),
          eq(appointments.status, "confirmed"),
          eq(appointments.startsAt, details.startsAt),
          eq(appointments.barberId, details.barberId),
        ),
      )
      .returning({ id: appointments.id });
    if (!row) return false;

    await tx.insert(appointmentEvents).values({
      appointmentId: id,
      type: "cancelled",
      actor,
      data: { startsAt: details.startsAt.toISOString() },
    });
    return true;
  });
  if (!cancelled) throw new NotModifiableError("changed");

  return {
    ...details,
    status: "cancelled",
    canModify: false,
    calendarSequence: details.calendarSequence + 1,
  };
}

/**
 * Moves a confirmed appointment to a new start time, optionally with a
 * different barber (admins only). The service and therefore the duration
 * stay the same.
 *
 * Same guarantees as a new booking: the new time must be one availability
 * offers (ignoring the appointment's own current time), the per-barber
 * lock is taken, and the exclusion constraint has the final word. The
 * UPDATE also checks that the appointment still has the start time we
 * read, so a concurrent change is detected instead of silently overwritten.
 * The reminder flag is reset so the customer is reminded of the new time.
 */
export async function rescheduleAppointment(
  db: Db,
  id: string,
  {
    startsAt,
    barberId,
    actor,
    now = new Date(),
  }: { startsAt: Date; barberId?: string; actor: Actor; now?: Date },
): Promise<{ before: AppointmentDetails; after: AppointmentDetails }> {
  const before = await getAppointmentDetails(db, id, now);
  if (!before) throw new NotFoundError("Appointment not found");
  assertModifiable(before, actor, now);

  const targetBarberId = actor === "customer" ? before.barberId : (barberId ?? before.barberId);
  if (targetBarberId === before.barberId && startsAt.getTime() === before.startsAt.getTime()) {
    return { before, after: before };
  }

  const slots = await getAvailability(db, {
    date: localDate(startsAt, before.timezone),
    serviceId: before.serviceId,
    barberId: targetBarberId,
    now,
    existingAppointment: {
      id,
      barberId: before.barberId,
      durationMinutes: before.durationMinutes,
    },
    policy: actor === "customer" ? "customer" : "staff",
  });
  const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw new SlotUnavailableError();

  let moved: boolean;
  try {
    moved = await withTransactionRetry(() =>
      db.transaction(async (tx) => {
        await lockBarberSchedule(tx, targetBarberId);

        const [row] = await tx
          .update(appointments)
          .set({
            barberId: targetBarberId,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            reminderSentAt: null,
          })
          .where(
            and(
              eq(appointments.id, id),
              eq(appointments.status, "confirmed"),
              // Compare everything this change was based on: a concurrent
              // move to another barber at the same time must not be
              // silently overwritten (lost update).
              eq(appointments.startsAt, before.startsAt),
              eq(appointments.barberId, before.barberId),
            ),
          )
          .returning({ id: appointments.id });
        if (!row) return false;

        await tx.insert(appointmentEvents).values({
          appointmentId: id,
          type: "rescheduled",
          actor,
          data: {
            from: before.startsAt.toISOString(),
            to: slot.startsAt.toISOString(),
            ...(targetBarberId !== before.barberId && {
              fromBarberId: before.barberId,
              toBarberId: targetBarberId,
            }),
          },
        });
        return true;
      }),
    );
  } catch (error) {
    if (isConstraintViolation(error, PG_ERROR.exclusionViolation, NO_OVERLAP_CONSTRAINT)) {
      throw new SlotUnavailableError();
    }
    throw error;
  }
  if (!moved) throw new NotModifiableError("changed");

  const after = await getAppointmentDetails(db, id, now);
  if (!after) throw new NotFoundError("Appointment not found");
  return { before, after };
}

/**
 * Staff-only status changes after the fact. Completed and no-show only make
 * sense once the appointment has started.
 */
export async function markAppointmentOutcome(
  db: Db,
  id: string,
  { outcome, now = new Date() }: { outcome: "completed" | "no_show"; now?: Date },
): Promise<void> {
  const details = await getAppointmentDetails(db, id, now);
  if (!details) throw new NotFoundError("Appointment not found");
  if (details.status !== "confirmed") throw new NotModifiableError("not_confirmed");
  if (details.startsAt > now) throw new NotModifiableError("not_started");

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(appointments)
      .set({ status: outcome })
      .where(
        and(
          eq(appointments.id, id),
          eq(appointments.status, "confirmed"),
          // A reschedule may have moved it into the future in the meantime.
          eq(appointments.startsAt, details.startsAt),
        ),
      )
      .returning({ id: appointments.id });
    if (!row) throw new NotModifiableError("changed");
    await tx.insert(appointmentEvents).values({ appointmentId: id, type: outcome, actor: "admin" });
  });
}
