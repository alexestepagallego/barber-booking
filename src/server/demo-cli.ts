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
void runWithDb((db) => resetDemo(db));
