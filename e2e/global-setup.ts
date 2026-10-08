import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createAdminUser } from "../src/server/admin/auth";
import { createDb } from "../src/server/db/client";
import { seedDatabase } from "../src/server/db/seed";

import { E2E_ADMIN, E2E_DATABASE_URL } from "./env";

/** Known state before every E2E run: migrated schema, demo catalogue, no bookings, one admin. */
export default async function globalSetup() {
  const { db, client } = createDb(E2E_DATABASE_URL, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    // The catalogue (services, barbers, hours) is restored by upserting on
    // slug, NOT truncated: its ids must stay stable across runs, because
    // Playwright starts the server (which caches the catalogue on its first
    // request) before this setup runs.
    await db.execute(sql`
      TRUNCATE appointment_events, appointments, time_off,
               admin_sessions, admin_users, rate_limits
      RESTART IDENTITY CASCADE
    `);
    await seedDatabase(db);
    await createAdminUser(db, E2E_ADMIN);
  } finally {
    await client.end();
  }
}
