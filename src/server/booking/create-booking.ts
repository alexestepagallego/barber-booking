import { eq } from "drizzle-orm";

import type { CreateBookingInput } from "@/lib/booking-schema";
import type { Db } from "@/server/db/client";
import { barbers, services, shopSettings } from "@/server/db/schema";
import { deriveManageToken } from "@/server/security/tokens";

import {
  findAppointmentByIdempotencyKey,
  insertAppointment,
  insertAppointmentWithAnyBarber,
  type InsertResult,
} from "./appointments-repository";
import { localDate } from "./availability";
import { SlotUnavailableError } from "./errors";
import { getAvailability } from "./get-availability";

export type CreateBookingResult = InsertResult & {
  barberName: string;
  serviceName: string;
};

/**
 * Books an appointment requested by a customer.
 *
 * 1. Business rules: the requested start must be one the availability engine
 *    offers right now (opening hours, notice, horizon, service duration,
 *    time off, barber offers the service). Anything else is rejected the
 *    same way as a taken slot, so the API never reveals why.
 * 2. Overlaps: decided by the database at INSERT time (see concurrency.md).
 *    Step 1 only filters; it is not what prevents double bookings.
 *
 * For "no preference", the barbers free at that time are tried least booked
 * first. If another request wins one of them in the meantime, the next one
 * is tried.
 *
 * A retried request (same idempotency key) is answered with the original
 * booking before any availability check, because by then its own
 * appointment makes the slot look taken.
 */
export async function createBooking(
  db: Db,
  input: CreateBookingInput,
  options: { idempotencyKey?: string; now?: Date } = {},
): Promise<CreateBookingResult> {
  if (options.idempotencyKey) {
    const existing = await findAppointmentByIdempotencyKey(db, options.idempotencyKey);
    if (existing)
      return withNames(db, {
        appointment: existing,
        manageToken: deriveManageToken(existing.id),
        replayed: true,
      });
  }

  const [settings] = await db.select().from(shopSettings).where(eq(shopSettings.id, 1));
  if (!settings) throw new Error("Shop settings are missing. Run the seed script.");

  const slots = await getAvailability(db, {
    date: localDate(input.startsAt, settings.timezone),
    serviceId: input.serviceId,
    barberId: input.barberId ?? undefined,
    now: options.now,
  });
  const slot = slots.find((s) => s.startsAt.getTime() === input.startsAt.getTime());
  if (!slot) throw new SlotUnavailableError();

  const values = {
    serviceId: input.serviceId,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    idempotencyKey: options.idempotencyKey,
    actor: "customer" as const,
  };

  const result = input.barberId
    ? await insertAppointment(db, { ...values, barberId: input.barberId })
    : await insertAppointmentWithAnyBarber(db, slot.barberIds, values);

  return withNames(db, result);
}

async function withNames(db: Db, result: InsertResult): Promise<CreateBookingResult> {
  const [names] = await db
    .select({ barberName: barbers.name, serviceName: services.name })
    .from(barbers)
    .innerJoin(services, eq(services.id, result.appointment.serviceId))
    .where(eq(barbers.id, result.appointment.barberId));

  return { ...result, barberName: names?.barberName ?? "", serviceName: names?.serviceName ?? "" };
}
