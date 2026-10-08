import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "../../src/server/db/client";
import { resetDemo } from "../../src/server/demo";
import { E2E_ADMIN, E2E_DATABASE_URL } from "../../e2e/env";

/** Demo data (a realistic agenda) plus the E2E admin account. */
export default async function setup() {
  process.env.DEMO_ADMIN_EMAIL = E2E_ADMIN.email;
  process.env.DEMO_ADMIN_PASSWORD = E2E_ADMIN.password;
  const { db, client } = createDb(E2E_DATABASE_URL, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    await resetDemo(db);
  } finally {
    await client.end();
  }
}
