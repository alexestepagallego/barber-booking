import { revalidateTag } from "next/cache";

import { CATALOGUE_TAG } from "@/server/catalogue";
import { isDemoMode } from "@/server/config";
import { getDb } from "@/server/db/client";
import { resetDemo } from "@/server/demo";
import { isAuthorizedCron } from "@/server/http/cron-auth";
import { purgeExpiredSessions } from "@/server/admin/auth";
import { erasePersonalData } from "@/server/maintenance";
import { purgeExpiredRateLimits } from "@/server/security/rate-limit";

export const maxDuration = 60;

/**
 * GET /api/cron/maintenance — nightly (see vercel.json).
 * Erases customer personal data past the retention period, removes expired
 * admin sessions and rate-limit counters, and in demo mode resets the demo.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const result = {
    ...(await erasePersonalData(db)),
    expiredSessions: await purgeExpiredSessions(db),
    expiredRateLimits: await purgeExpiredRateLimits(db),
  };
  // The public demo starts every day from the same clean state.
  const demo = isDemoMode() ? await resetDemo(db) : null;
  // The reset rewrote the catalogue behind the app's back: drop the cache.
  if (demo) revalidateTag(CATALOGUE_TAG, { expire: 0 });

  console.info("[cron] maintenance", { ...result, demo });
  return Response.json({ ...result, demo }, { headers: { "Cache-Control": "no-store" } });
}
