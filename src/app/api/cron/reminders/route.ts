import { getDb } from "@/server/db/client";
import { sendDueReminders } from "@/server/email/notifications";
import { isAuthorizedCron } from "@/server/http/cron-auth";
import { describeError } from "@/server/log";

// Sending a batch of emails can take a while; allow up to a minute.
export const maxDuration = 60;

/**
 * GET /api/cron/reminders — daily (see vercel.json). Emails every customer
 * with a confirmed appointment tomorrow. Safe to run twice: each
 * appointment is claimed atomically before its email is sent.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await sendDueReminders(getDb());
    console.info("[cron] reminders", result);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron] reminders failed", describeError(error));
    return Response.json({ error: "Reminder run failed" }, { status: 500 });
  }
}
