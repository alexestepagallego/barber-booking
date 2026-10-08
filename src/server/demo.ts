import { asc, eq, sql } from "drizzle-orm";

import { addDays } from "@/lib/calendar";
import { createAdminUser } from "@/server/admin/auth";
import { localDate } from "@/server/booking/availability";
import { createBooking } from "@/server/booking/create-booking";
import { SlotUnavailableError } from "@/server/booking/errors";
import { getAvailability } from "@/server/booking/get-availability";
import { demoAdmin } from "@/server/config";
import type { Db } from "@/server/db/client";
import { adminUsers, barberServices, barbers, shopSettings } from "@/server/db/schema";
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
 * Sample bookings go through createBooking like any other, so they obey
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

  const today = localDate(now, settings!.timezone);
  let created = 0;

  for (let offset = 0; offset < SAMPLE_DAYS; offset++) {
    const date = addDays(today, offset);
    const random = seededRandom(date);

    for (const barber of activeBarbers) {
      const serviceIds = offered.filter((o) => o.barberId === barber.id).map((o) => o.serviceId);
      // Walk the day's free starts (on the grid of the barber's first
      // service) and book some of them with a random service each.
      const gridService = serviceIds[0];
      if (!gridService) continue;
      const slots = await getAvailability(db, {
        date,
        serviceId: gridService,
        barberId: barber.id,
        now,
        policy: "staff",
      });

      let busyUntil = 0;
      for (const slot of slots) {
        if (slot.startsAt.getTime() < busyUntil || random() > OCCUPANCY / 2) continue;
        try {
          const { appointment } = await createBooking(
            db,
            {
              serviceId: serviceIds[Math.floor(random() * serviceIds.length)]!,
              barberId: barber.id,
              startsAt: slot.startsAt,
              customerName: SAMPLE_NAMES[Math.floor(random() * SAMPLE_NAMES.length)]!,
              customerEmail: "",
              customerPhone: "",
            },
            { actor: "admin", now },
          );
          busyUntil = appointment.endsAt.getTime();
          created++;
        } catch (error) {
          // A longer service may not fit before a break: skip that start.
          if (!(error instanceof SlotUnavailableError)) throw error;
        }
      }
    }
  }

  return { sampleAppointments: created, demoAdmin: credentials?.email ?? null };
}
