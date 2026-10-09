import { eq, lt, sql } from "drizzle-orm";

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
  /** Admin sign-in attempts per IP, successful or not. */
  loginPerIp: { name: "login:ip", limit: 20, windowSeconds: 15 * 60 },
  /**
   * FAILED sign-ins per account and IP. Keyed by both, so a stranger who
   * knows the owner's email can only lock out themselves, never the owner.
   */
  loginFailuresPerAccountAndIp: { name: "login:fail:account-ip", limit: 5, windowSeconds: 15 * 60 },
  /** FAILED sign-ins per account from anywhere: a ceiling against distributed guessing. */
  loginFailuresPerAccount: { name: "login:fail:account", limit: 50, windowSeconds: 60 * 60 },
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

/**
 * Reads a counter without incrementing it: "would one more be allowed?".
 * For limits that only count failures, checked before the attempt and
 * incremented (with checkRateLimit) only when it fails.
 */
export async function peekRateLimit(
  db: Db,
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<RateLimitResult> {
  const [row] = await db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, `${rule.name}:${subject}`));
  if (!row || row.resetAt <= now) {
    return { allowed: true, remaining: rule.limit, retryAfter: 0 };
  }
  return {
    allowed: row.count < rule.limit,
    remaining: Math.max(0, rule.limit - row.count),
    retryAfter: Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Forgets a counter, e.g. failed sign-ins after a successful one. */
export async function resetRateLimit(db: Db, rule: RateLimitRule, subject: string) {
  await db.delete(rateLimits).where(eq(rateLimits.key, `${rule.name}:${subject}`));
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
 *
 * IPv6 addresses are reduced to their /64 prefix: one home line or server
 * usually controls a whole /64, so rotating the last 64 bits must not buy a
 * fresh budget. IPv4-mapped IPv6 (::ffff:1.2.3.4) becomes plain IPv4.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip") || "";
  return ip ? rateLimitIpKey(ip) : "local";
}

export function rateLimitIpKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;

  // Expand "::" so the first four groups can be read reliably.
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * Key for per-recipient limits. Mail providers deliver "ana+1@…" to "ana@…",
 * and Gmail ignores dots, so those variants must share one budget. Only the
 * key is normalised: the booking keeps the address exactly as typed.
 */
export function rateLimitEmailKey(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const base = local.split("+")[0]!;
  const gmail = domain === "gmail.com" || domain === "googlemail.com";
  return `${gmail ? base.replace(/\./g, "") : base}@${gmail ? "gmail.com" : domain}`;
}
