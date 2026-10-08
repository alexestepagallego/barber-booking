import { getDb } from "@/server/db/client";
import { isAuthorizedCron } from "@/server/http/cron-auth";
import { purgeExpiredSessions } from "@/server/admin/auth";
import { erasePersonalData } from "@/server/maintenance";
import { purgeExpiredRateLimits } from "@/server/security/rate-limit";

export const maxDuration = 60;

/**
 * GET /api/cron/maintenance — nightly (see vercel.json).
 * Erases customer personal data past the retention period and removes
 * expired admin sessions and rate-limit counters.
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
  console.info("[cron] maintenance", result);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
