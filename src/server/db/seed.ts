import { pathToFileURL } from "node:url";

import { config } from "dotenv";
import { inArray, sql } from "drizzle-orm";

import { createDb, type Db } from "./client";
import { BARBERS, SERVICES, SHOP, WEEKLY_SHIFTS } from "./seed-data";
import { barberServices, barbers, services, shopSettings, workingHours } from "./schema";

/**
 * Idempotent: running it again restores the demo catalogue (upserts by slug,
 * so ids stay stable) without touching appointments. The app caches the
 * catalogue; callers inside a running app must invalidate the "catalogue"
 * tag afterwards (the demo reset does).
 */
export async function seedDatabase(db: Db) {
  return db.transaction(async (tx) => {
    await tx
      .insert(shopSettings)
      .values({ id: 1, ...SHOP })
      .onConflictDoUpdate({ target: shopSettings.id, set: { ...SHOP } });

    const barberRows = await tx
      .insert(barbers)
      .values([...BARBERS])
      .onConflictDoUpdate({
        target: barbers.slug,
        set: {
          name: sql`excluded.name`,
          bio: sql`excluded.bio`,
          sortOrder: sql`excluded.sort_order`,
          active: true,
        },
      })
      .returning();

    const serviceRows = await tx
      .insert(services)
      .values([...SERVICES])
      .onConflictDoUpdate({
        target: services.slug,
        set: {
          name: sql`excluded.name`,
          durationMinutes: sql`excluded.duration_minutes`,
          priceCents: sql`excluded.price_cents`,
          sortOrder: sql`excluded.sort_order`,
          active: true,
        },
      })
      .returning();

    await tx
      .insert(barberServices)
      .values(
        barberRows.flatMap((barber) =>
          serviceRows.map((service) => ({ barberId: barber.id, serviceId: service.id })),
        ),
      )
      .onConflictDoNothing();

    const barberIds = barberRows.map((barber) => barber.id);
    await tx.delete(workingHours).where(inArray(workingHours.barberId, barberIds));
    await tx
      .insert(workingHours)
      .values(
        barberIds.flatMap((barberId) => WEEKLY_SHIFTS.map((shift) => ({ barberId, ...shift }))),
      );

    return { barbers: barberRows, services: serviceRows };
  });
}

async function main() {
  config({ path: [".env.local", ".env"], quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const { db, client } = createDb(url, { max: 1 });
  try {
    const { barbers: b, services: s } = await seedDatabase(db);
    console.log(`Seeded ${b.length} barbers and ${s.length} services`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
