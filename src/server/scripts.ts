import { config } from "dotenv";

import { createDb, type Db } from "@/server/db/client";

/** Shared bootstrap for the small CLIs in this folder (`npm run demo:reset`, …). */
export async function runWithDb(task: (db: Db) => Promise<unknown>) {
  config({ path: [".env.local", ".env"], quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, client } = createDb(url, { max: 1 });
  try {
    console.log(await task(db));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
