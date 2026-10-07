import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "@/server/db/client";

import { getTestDatabaseUrl } from "./test-db";

/** Runs once before the integration suite: brings the test database schema up to date. */
export default async function setup() {
  const { db, client } = createDb(getTestDatabaseUrl(), { max: 1 });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
