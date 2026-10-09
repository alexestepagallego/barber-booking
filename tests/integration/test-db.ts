import { config } from "dotenv";
import { sql } from "drizzle-orm";

import { createDb, type Db } from "@/server/db/client";
import { seedDatabase } from "@/server/db/seed";

config({ path: [".env.test.local", ".env.local", ".env"], quiet: true });

export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Copy .env.example to .env.local.");
  }
  // Tests TRUNCATE every table. Refuse to run against anything that is not
  // obviously a test database.
  if (!new URL(url).pathname.includes("test")) {
    throw new Error(
      `Refusing to run destructive tests on "${url}": the database name must contain "test"`,
    );
  }
  return url;
}

/** A connection pool big enough to run every concurrent request on its own connection. */
export function createTestDb(max = 60) {
  return createDb(getTestDatabaseUrl(), { max });
}

/** Wipes all data and loads the demo catalogue. Returns the seeded rows. */
export async function resetDatabase(db: Db) {
  await db.execute(sql`
    TRUNCATE appointment_events, appointments, time_off, working_hours,
             barber_services, barbers, services, shop_settings,
             admin_sessions, admin_users, rate_limits
    RESTART IDENTITY CASCADE
  `);
  return seedDatabase(db);
}

/** Builds a Date for a fixed day far in the future so tests never depend on "now". */
export function at(time: string, day = "2030-06-03"): Date {
  return new Date(`${day}T${time}:00+02:00`);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export const customer = {
  customerName: "Test Customer",
  customerEmail: "customer@example.com",
  customerPhone: "+34600000000",
  // Only used by tests that insert appointments directly (createBooking
  // looks the price up itself).
  priceCents: 1500,
} as const;
