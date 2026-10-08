import { lt, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";

export type RateLimitRule = {
  /** Namespaces the counter, e.g. "booking". */
  name: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Use for the Retry-After header. */
  retryAfter: number;
};

/** Every limit the app applies, in one place so they are easy to review and tune. */
export const RATE_LIMITS = {
  /** New bookings per IP. Generous for families booking several people. */
  bookingPerIp: { name: "booking:ip", limit: 10, windowSeconds: 60 * 60 },
  /** Confirmation emails per recipient address: stops using the form to spam someone. */
  bookingPerEmail: { name: "booking:email", limit: 5, windowSeconds: 24 * 60 * 60 },
  /** Availability lookups per IP: plenty for a human clicking through days. */
  availabilityPerIp: { name: "availability:ip", limit: 120, windowSeconds: 60 },
  /** Cancel/reschedule attempts per IP. */
  manageWritePerIp: { name: "manage:ip", limit: 30, windowSeconds: 60 * 60 },
  /** Admin sign-in attempts per IP and per account (slows password guessing). */
  loginPerIp: { name: "login:ip", limit: 20, windowSeconds: 15 * 60 },
  loginPerAccount: { name: "login:account", limit: 5, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter in Postgres: one atomic upsert per check, shared by
 * every serverless instance (in-memory counters would not be). Reset
 * windows are handled inside the same statement, so concurrent requests
 * can never both start a fresh window.
 * See docs/adr/0005-rate-limiting-in-postgres.md.
 */
export async function checkRateLimit(
  db: Db,
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<RateLimitResult> {
  const key = `${rule.name}:${subject}`;
  const resetAt = new Date(now.getTime() + rule.windowSeconds * 1000);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.resetAt} <= ${now.toISOString()}::timestamptz THEN 1 ELSE ${rateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= ${now.toISOString()}::timestamptz THEN ${resetAt.toISOString()}::timestamptz ELSE ${rateLimits.resetAt} END`,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });

  const count = row?.count ?? 1;
  const retryAfter = Math.max(
    1,
    Math.ceil(((row?.resetAt ?? resetAt).getTime() - now.getTime()) / 1000),
  );
  return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), retryAfter };
}

/** Removes expired counters. Called from the nightly maintenance cron. */
export async function purgeExpiredRateLimits(db: Db, now = new Date()) {
  const deleted = await db
    .delete(rateLimits)
    .where(lt(rateLimits.resetAt, now))
    .returning({ key: rateLimits.key });
  return deleted.length;
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for to the real client
 * address (first entry) and overwrites anything the client sent; locally
 * there is no proxy, so everything shares the "local" bucket.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "local";
}
