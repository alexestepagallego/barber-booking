import { asc, eq, sql } from "drizzle-orm";

import { addDays } from "@/lib/calendar";
import { createAdminUser } from "@/server/admin/auth";
import { localDate } from "@/server/booking/availability";
import { insertAppointment } from "@/server/booking/appointments-repository";
import { SlotUnavailableError } from "@/server/booking/errors";
import { getAvailability } from "@/server/booking/get-availability";
import { demoAdmin } from "@/server/config";
import type { Db } from "@/server/db/client";
import { adminUsers, barberServices, barbers, services, shopSettings } from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";

/**
 * Nightly reset of the public demo, so every visitor finds the same tidy
 * shop no matter what earlier visitors did in the admin panel:
 *
 * 1. deletes every booking, absence, session and rate-limit counter,
 * 2. restores the demo catalogue, opening hours and settings (stable ids),
 * 3. recreates the demo admin as the only admin account,
 * 4. fills the next days with plausible sample bookings, so the agenda and
 *    the availability look like a real shop's.
 *
 * Sample bookings only use start times that availability offers, and are
 * inserted through insertAppointment like any other booking, so they obey
 * opening hours and the no-overlap guarantee. They have no email address:
 * no email is ever sent for them.
 *
 * The caller must invalidate the cached catalogue afterwards.
 */

const SAMPLE_DAYS = 6;
/** Roughly how full the sample agenda is. */
const OCCUPANCY = 0.45;
const SAMPLE_NAMES = [
  "Carlos M.",
  "Javier R.",
  "Miguel A.",
  "David L.",
  "Pablo S.",
  "Sergio G.",
  "Álvaro P.",
  "Daniel F.",
  "Adrián T.",
  "Hugo N.",
  "Marcos V.",
  "Iván C.",
];

/** Small deterministic generator: the same day always gets the same sample agenda. */
function seededRandom(seedText: string) {
  let seed = [...seedText].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 2 ** 32;
  };
}

export async function resetDemo(db: Db, now = new Date()) {
  await db.execute(sql`
    TRUNCATE appointment_events, appointments, time_off, admin_sessions, rate_limits
    RESTART IDENTITY CASCADE
  `);
  await seedDatabase(db);

  const credentials = demoAdmin();
  await db.delete(adminUsers);
  if (credentials) {
    await createAdminUser(db, { ...credentials, name: "Demo admin" });
  }

  const [settings] = await db.select().from(shopSettings).where(eq(shopSettings.id, 1));
  const activeBarbers = await db
    .select({ id: barbers.id })
    .from(barbers)
    .where(eq(barbers.active, true))
    .orderBy(asc(barbers.sortOrder));
  const offered = await db.select().from(barberServices);

  const prices = new Map(
    (await db.select({ id: services.id, priceCents: services.priceCents }).from(services)).map(
      (row) => [row.id, row.priceCents],
    ),
  );

  const today = localDate(now, settings!.timezone);
  let created = 0;

  // One barber's sample day. Availability is computed once per service up
  // front (not once per booking), then bookings are inserted in time order.
  // insertAppointment still takes the per-barber lock and the database
  // constraint still has the final word, exactly as for real bookings.
  async function fillDay(date: string, barberId: string) {
    const random = seededRandom(`${date}:${barberId}`);
    const serviceIds = offered.filter((o) => o.barberId === barberId).map((o) => o.serviceId);
    if (serviceIds.length === 0) return;

    const slotsByService = new Map(
      await Promise.all(
        serviceIds.map(
          async (serviceId) =>
            [
              serviceId,
              await getAvailability(db, { date, serviceId, barberId, now, policy: "staff" }),
            ] as const,
        ),
      ),
    );

    let busyUntil = 0;
    // Walk the day on the grid of the barber's first service.
    for (const slot of slotsByService.get(serviceIds[0]!)!) {
      if (slot.startsAt.getTime() < busyUntil || random() > OCCUPANCY / 2) continue;
      const serviceId = serviceIds[Math.floor(random() * serviceIds.length)]!;
      const name = SAMPLE_NAMES[Math.floor(random() * SAMPLE_NAMES.length)]!;
      // The chosen service must fit at this start (it may be longer than the grid's).
      const fit = slotsByService
        .get(serviceId)!
        .find((s) => s.startsAt.getTime() === slot.startsAt.getTime());
      if (!fit) continue;
      try {
        await insertAppointment(db, {
          barberId,
          serviceId,
          customerName: name,
          customerEmail: "",
          customerPhone: "",
          startsAt: fit.startsAt,
          endsAt: fit.endsAt,
          priceCents: prices.get(serviceId) ?? 0,
          actor: "admin",
        });
        busyUntil = fit.endsAt.getTime();
        created++;
      } catch (error) {
        if (!(error instanceof SlotUnavailableError)) throw error;
      }
    }
  }

  for (let offset = 0; offset < SAMPLE_DAYS; offset++) {
    const date = addDays(today, offset);
    // Barbers never share a lock, so their days fill in parallel.
    await Promise.all(activeBarbers.map((barber) => fillDay(date, barber.id)));
  }

  return { sampleAppointments: created, demoAdmin: credentials?.email ?? null };
}
