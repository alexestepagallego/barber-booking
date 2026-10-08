import { and, asc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import {
  appointments,
  barberServices,
  barbers,
  services,
  shopSettings,
  timeOff,
  workingHours,
} from "@/server/db/schema";

import { computeAvailableSlots, dayBounds, isoWeekday, type Slot } from "./availability";
import { NotFoundError } from "./errors";

export type AvailabilityRequest = {
  /** Shop-local date, "YYYY-MM-DD". */
  date: string;
  serviceId: string;
  /** A specific barber, or undefined for "no preference". */
  barberId?: string;
  now?: Date;
  /**
   * Ignore this appointment's own time when rescheduling it, so moving a
   * booking by 15 minutes is not blocked by the booking itself.
   */
  excludeAppointmentId?: string;
  /**
   * "customer" applies the shop's notice and horizon rules. "staff" (admin
   * panel) can book for right now (walk-ins) and up to a year ahead.
   */
  policy?: "customer" | "staff";
};

const STAFF_HORIZON_DAYS = 365;

/**
 * Loads everything that affects one day's availability and hands it to the
 * pure engine in availability.ts. Read-only: the result is a hint for the UI,
 * and the database constraint has the final word when a booking is made.
 */
export async function getAvailability(db: Db, request: AvailabilityRequest): Promise<Slot[]> {
  const now = request.now ?? new Date();
  const staff = request.policy === "staff";

  const [settings] = await db.select().from(shopSettings).where(eq(shopSettings.id, 1));
  if (!settings) throw new Error("Shop settings are missing. Run the seed script.");

  const [service] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, request.serviceId), eq(services.active, true)));
  if (!service) throw new NotFoundError("Service not found");

  // Active barbers who offer this service (optionally just the requested one).
  const eligible = await db
    .select({ id: barbers.id })
    .from(barbers)
    .innerJoin(barberServices, eq(barberServices.barberId, barbers.id))
    .where(
      and(
        eq(barbers.active, true),
        eq(barberServices.serviceId, service.id),
        request.barberId ? eq(barbers.id, request.barberId) : undefined,
      ),
    )
    .orderBy(asc(barbers.sortOrder), asc(barbers.name));
  if (request.barberId && eligible.length === 0) {
    throw new NotFoundError("Barber not found or does not offer this service");
  }

  const barberIds = eligible.map((b) => b.id);
  if (barberIds.length === 0) return [];

  const day = dayBounds(request.date, settings.timezone);
  const [shifts, absences, booked] = await Promise.all([
    db
      .select()
      .from(workingHours)
      .where(
        and(
          inArray(workingHours.barberId, barberIds),
          eq(workingHours.weekday, isoWeekday(request.date)),
        ),
      ),
    db
      .select()
      .from(timeOff)
      .where(
        and(
          or(inArray(timeOff.barberId, barberIds), isNull(timeOff.barberId)),
          lt(timeOff.startsAt, day.end),
          gt(timeOff.endsAt, day.start),
        ),
      ),
    db
      .select({
        barberId: appointments.barberId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
      })
      .from(appointments)
      .where(
        and(
          inArray(appointments.barberId, barberIds),
          eq(appointments.status, "confirmed"),
          lt(appointments.startsAt, day.end),
          gt(appointments.endsAt, day.start),
          request.excludeAppointmentId
            ? ne(appointments.id, request.excludeAppointmentId)
            : undefined,
        ),
      ),
  ]);

  return computeAvailableSlots({
    date: request.date,
    timezone: settings.timezone,
    durationMinutes: service.durationMinutes,
    slotIntervalMinutes: settings.slotIntervalMinutes,
    minNoticeMinutes: staff ? 0 : settings.minNoticeMinutes,
    bookingHorizonDays: staff ? STAFF_HORIZON_DAYS : settings.bookingHorizonDays,
    now,
    barbers: barberIds.map((barberId) => {
      const own = booked.filter((a) => a.barberId === barberId);
      return {
        barberId,
        shifts: shifts.filter((s) => s.barberId === barberId),
        busy: [
          ...own.map((a) => ({ start: a.startsAt, end: a.endsAt })),
          ...absences
            .filter((t) => t.barberId === null || t.barberId === barberId)
            .map((t) => ({ start: t.startsAt, end: t.endsAt })),
        ],
        bookedMinutes: own.reduce(
          (sum, a) => sum + (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000,
          0,
        ),
      };
    }),
  });
}
