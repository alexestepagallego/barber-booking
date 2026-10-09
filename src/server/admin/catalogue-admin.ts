import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";

import type {
  barberSchema,
  serviceSchema,
  shopSettingsSchema,
  timeOffSchema,
  weekScheduleSchema,
} from "@/lib/admin-schema";
import { addDays } from "@/lib/calendar";
import { zonedDateTime } from "@/server/booking/availability";
import type { Db } from "@/server/db/client";
import { isConstraintViolation, PG_ERROR } from "@/server/db/errors";
import {
  appointments,
  barberServices,
  barbers,
  services,
  shopSettings,
  timeOff,
  workingHours,
} from "@/server/db/schema";

/**
 * Admin-side writes to the catalogue. Callers (Server Actions) check the
 * session and then invalidate the cached catalogue with updateTag().
 * Nothing here deletes services or barbers that have appointments: they are
 * deactivated instead, so history and foreign keys stay intact.
 */

// Combining diacritical marks (U+0300–U+036F), written as escapes on purpose:
// as literal characters they would be invisible in the source.
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "item";

async function uniqueSlug(
  db: Pick<Db, "select">,
  table: typeof services | typeof barbers,
  name: string,
) {
  const base = slugify(name);
  const taken = new Set((await db.select({ slug: table.slug }).from(table)).map((r) => r.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * Two admins creating "Fade" at the same moment would both pick the slug
 * "fade"; the loser hits the unique constraint. Retrying recomputes the
 * slug ("fade-2") instead of failing.
 */
async function withSlugRetry<T>(create: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await create();
    } catch (error) {
      const slugTaken =
        isConstraintViolation(error, PG_ERROR.uniqueViolation, "services_slug_unique") ||
        isConstraintViolation(error, PG_ERROR.uniqueViolation, "barbers_slug_unique");
      if (!slugTaken || attempt >= 5) throw error;
    }
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serialises edits of one barber's schedule and services. Their saves
 * replace rows (DELETE + INSERT); without a lock, two concurrent saves
 * under READ COMMITTED would merge both versions instead of one winning.
 */
async function lockBarberRow(tx: Tx, barberId: string) {
  await tx.execute(sql`SELECT 1 FROM ${barbers} WHERE ${barbers.id} = ${barberId} FOR UPDATE`);
}

export async function saveService(db: Db, input: z.output<typeof serviceSchema>) {
  const values = {
    name: input.name,
    description: input.description || null,
    durationMinutes: input.durationMinutes,
    priceCents: Math.round(input.price * 100),
    sortOrder: input.sortOrder,
    active: input.active,
  };
  if (input.id) {
    await db.update(services).set(values).where(eq(services.id, input.id));
    return input.id;
  }
  return withSlugRetry(() =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(services)
        .values({ ...values, slug: await uniqueSlug(tx, services, input.name) })
        .returning({ id: services.id });
      // A new service is offered by every active barber until configured otherwise.
      const active = await tx
        .select({ id: barbers.id })
        .from(barbers)
        .where(eq(barbers.active, true));
      if (active.length) {
        await tx
          .insert(barberServices)
          .values(active.map((b) => ({ barberId: b.id, serviceId: row!.id })))
          .onConflictDoNothing();
      }
      return row!.id;
    }),
  );
}

export async function saveBarber(db: Db, input: z.output<typeof barberSchema>) {
  return withSlugRetry(() =>
    db.transaction(async (tx) => {
      const values = {
        name: input.name,
        bio: input.bio || null,
        sortOrder: input.sortOrder,
        active: input.active,
      };
      let id = input.id;
      if (id) {
        await lockBarberRow(tx, id);
        await tx.update(barbers).set(values).where(eq(barbers.id, id));
      } else {
        const [row] = await tx
          .insert(barbers)
          .values({ ...values, slug: await uniqueSlug(tx, barbers, input.name) })
          .returning({ id: barbers.id });
        id = row!.id;
      }
      await tx.delete(barberServices).where(eq(barberServices.barberId, id));
      if (input.serviceIds.length) {
        await tx
          .insert(barberServices)
          .values(input.serviceIds.map((serviceId) => ({ barberId: id!, serviceId })));
      }
      return id;
    }),
  );
}

/** Replaces a barber's whole weekly schedule atomically, one save at a time. */
export async function saveWeekSchedule(db: Db, input: z.output<typeof weekScheduleSchema>) {
  await db.transaction(async (tx) => {
    await lockBarberRow(tx, input.barberId);
    await tx.delete(workingHours).where(eq(workingHours.barberId, input.barberId));
    const rows = input.days.flatMap((shifts, index) =>
      shifts.map((s) => ({ barberId: input.barberId, weekday: index + 1, ...s })),
    );
    if (rows.length) await tx.insert(workingHours).values(rows);
  });
}

/**
 * Adds an absence or closure. Dates are shop-local; without times it covers
 * whole days (start of the first day to the start of the day after the last).
 * Returns the confirmed appointments it overlaps, so staff can contact those
 * customers: they are deliberately NOT cancelled automatically.
 */
export async function addTimeOff(db: Db, input: z.output<typeof timeOffSchema>, timezone: string) {
  const startsAt = zonedDateTime(input.startDate, input.startTime ?? "00:00", timezone);
  const endsAt = input.endTime
    ? zonedDateTime(input.endDate, input.endTime, timezone)
    : zonedDateTime(addDays(input.endDate, 1), "00:00", timezone);
  if (endsAt <= startsAt) throw new RangeError("The time off must end after it starts");

  await db
    .insert(timeOff)
    .values({ barberId: input.barberId ?? null, startsAt, endsAt, reason: input.reason || null });

  return db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      customerName: appointments.customerName,
      customerPhone: appointments.customerPhone,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.status, "confirmed"),
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, startsAt),
        input.barberId ? eq(appointments.barberId, input.barberId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

export async function deleteTimeOff(db: Db, id: string) {
  await db.delete(timeOff).where(eq(timeOff.id, id));
}

export async function saveShopSettings(db: Db, input: z.output<typeof shopSettingsSchema>) {
  await db
    .update(shopSettings)
    .set({ ...input, phone: input.phone || null, address: input.address || null })
    .where(eq(shopSettings.id, 1));
}

/** Everything the admin catalogue pages show, including inactive items. */
export async function loadAdminCatalogue(db: Db, now = new Date()) {
  const [settings, serviceRows, barberRows, offered, hours, absences] = await Promise.all([
    db.select().from(shopSettings).where(eq(shopSettings.id, 1)),
    db.select().from(services).orderBy(asc(services.sortOrder), asc(services.name)),
    db.select().from(barbers).orderBy(asc(barbers.sortOrder), asc(barbers.name)),
    db.select().from(barberServices),
    db.select().from(workingHours).orderBy(asc(workingHours.weekday), asc(workingHours.startTime)),
    db.select().from(timeOff).where(gt(timeOff.endsAt, now)).orderBy(asc(timeOff.startsAt)),
  ]);
  return {
    settings: settings[0]!,
    services: serviceRows,
    barbers: barberRows.map((b) => ({
      ...b,
      serviceIds: offered.filter((o) => o.barberId === b.id).map((o) => o.serviceId),
      hours: hours.filter((h) => h.barberId === b.id),
    })),
    timeOff: absences,
  };
}

/** Confirmed and past appointments for one shop-local day, per barber. */
export async function loadAgenda(db: Db, day: { start: Date; end: Date }) {
  return db
    .select({
      id: appointments.id,
      barberId: appointments.barberId,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      customerName: appointments.customerName,
      customerPhone: appointments.customerPhone,
      serviceName: services.name,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(and(lt(appointments.startsAt, day.end), gt(appointments.endsAt, day.start)))
    .orderBy(asc(appointments.startsAt));
}

export async function loadTimeOffForDay(
  db: Db,
  day: { start: Date; end: Date },
  barberIds: string[],
) {
  return db
    .select()
    .from(timeOff)
    .where(
      and(
        lt(timeOff.startsAt, day.end),
        gt(timeOff.endsAt, day.start),
        barberIds.length
          ? or(isNull(timeOff.barberId), inArray(timeOff.barberId, barberIds))
          : isNull(timeOff.barberId),
      ),
    );
}
