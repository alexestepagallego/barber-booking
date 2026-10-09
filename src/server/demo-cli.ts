import { config } from "dotenv";

import { resetDemo } from "./demo";
import { runWithDb } from "./scripts";

/**
 * npm run demo:reset -- --yes
 * Wipes all bookings and admin accounts of the database in DATABASE_URL and
 * loads the demo data. Destructive, hence the explicit --yes. A running app
 * keeps its cached catalogue for up to an hour; the nightly cron (which
 * does the same reset) also invalidates that cache.
 */
if (!process.argv.includes("--yes")) {
  console.error("This deletes every booking and admin account. Re-run with --yes to continue.");
  process.exit(1);
}
// Sample bookings get manage links derived from MANAGE_LINK_SECRET. Against
// a remote database, a missing secret would silently use the development
// default and leave the deployed demo with broken links.
config({ path: [".env.local", ".env"], quiet: true });
const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url) && (process.env.MANAGE_LINK_SECRET ?? "").length < 32) {
  console.error("Remote database: set the deployment's MANAGE_LINK_SECRET first, or use the cron.");
  process.exit(1);
}
void runWithDb((db) => resetDemo(db));
