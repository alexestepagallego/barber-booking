import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron calls our endpoints with `Authorization: Bearer $CRON_SECRET`.
 * The comparison is constant-time (both sides hashed to the same length
 * first) so response timing does not leak the secret. Without a configured
 * secret the endpoints are closed, never open.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(`Bearer ${secret}`));
}
