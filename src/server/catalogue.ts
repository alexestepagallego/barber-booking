import { asc, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { getDb } from "@/server/db/client";
import { barberServices, barbers, services, shopSettings, workingHours } from "@/server/db/schema";

export const CATALOGUE_TAG = "catalogue";

export type Catalogue = Awaited<ReturnType<typeof getCatalogue>>;

/**
 * Everything the public pages need that changes rarely: shop settings,
 * services, barbers and opening hours.
 *
 * Cached across requests for an hour. When the admin panel edits any of it,
 * it calls revalidateTag(CATALOGUE_TAG) so changes show up immediately.
 * Callers must await `connection()` first so the query runs at request time,
 * not during `next build` (the build must not depend on a database).
 */
export async function getCatalogue() {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOGUE_TAG);

  const db = getDb();
  const [settings, serviceRows, barberRows, offered, hours] = await Promise.all([
    db.select().from(shopSettings).where(eq(shopSettings.id, 1)),
    db
      .select()
      .from(services)
      .where(eq(services.active, true))
      .orderBy(asc(services.sortOrder), asc(services.name)),
    db
      .select()
      .from(barbers)
      .where(eq(barbers.active, true))
      .orderBy(asc(barbers.sortOrder), asc(barbers.name)),
    db.select().from(barberServices),
    db.select().from(workingHours),
  ]);

  const shop = settings[0];
  if (!shop) throw new Error("Shop settings are missing. Run the seed script.");
  const activeBarberIds = new Set(barberRows.map((b) => b.id));

  return {
    shop: {
      name: shop.name,
      timezone: shop.timezone,
      bookingHorizonDays: shop.bookingHorizonDays,
      cancellationCutoffMinutes: shop.cancellationCutoffMinutes,
    },
    services: serviceRows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
    })),
    barbers: barberRows.map((b) => ({
      id: b.id,
      name: b.name,
      bio: b.bio,
      serviceIds: offered.filter((o) => o.barberId === b.id).map((o) => o.serviceId),
    })),
    openingHours: shopOpeningHours(hours.filter((h) => activeBarberIds.has(h.barberId))),
  };
}

/**
 * Collapses every active barber's shifts into the shop's opening hours per
 * weekday: the union of all shifts, merged where they touch or overlap.
 */
function shopOpeningHours(shifts: { weekday: number; startTime: string; endTime: string }[]) {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const ranges = shifts
      .filter((s) => s.weekday === weekday)
      .map((s) => ({ start: s.startTime.slice(0, 5), end: s.endTime.slice(0, 5) }))
      .sort((a, b) => a.start.localeCompare(b.start));

    const merged: { start: string; end: string }[] = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range.start <= last.end) {
        if (range.end > last.end) last.end = range.end;
      } else {
        merged.push({ ...range });
      }
    }
    return { weekday, ranges: merged };
  });
}
