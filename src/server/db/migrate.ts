import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "./client";

config({ path: [".env.local", ".env"], quiet: true });

/** Applies pending migrations from ./drizzle. Usage: npm run db:migrate [-- --test] */
async function main() {
  const useTestDb = process.argv.includes("--test");
  const url = useTestDb ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) {
    throw new Error(`${useTestDb ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set`);
  }

  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
