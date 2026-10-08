import { getDb } from "@/server/db/client";
import { isAuthorizedCron } from "@/server/http/cron-auth";
import { erasePersonalData } from "@/server/maintenance";

export const maxDuration = 60;

/**
 * GET /api/cron/maintenance — nightly (see vercel.json).
 * Erases customer personal data past the retention period.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await erasePersonalData(getDb());
  console.info("[cron] maintenance", result);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
