import type { Db } from "@/server/db/client";
import {
  checkRateLimit,
  peekRateLimit,
  RATE_LIMITS,
  resetRateLimit,
} from "@/server/security/rate-limit";

import { verifyCredentials } from "./auth";

export type LoginAttempt =
  | { ok: true; admin: { id: string; email: string; name: string } }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfter: number };

/**
 * Checks a sign-in attempt against the rate limits and the credentials.
 * Kept apart from the Server Action (which only adds cookies and the
 * redirect) so the rules below are covered by integration tests.
 *
 * 1. Every attempt from an IP counts, successful or not.
 * 2. Only FAILED attempts count per account: per account + IP (so a
 *    stranger who knows the owner's email can only lock out themselves) and
 *    per account overall (a high ceiling against distributed guessing).
 * 3. A successful sign-in clears that account + IP failure counter.
 */
export async function attemptLogin(
  db: Db,
  { email, password, ip }: { email: string; password: string; ip: string },
  now = new Date(),
): Promise<LoginAttempt> {
  const pair = `${email}:${ip}`;

  const byIp = await checkRateLimit(db, RATE_LIMITS.loginPerIp, ip, now);
  if (!byIp.allowed) return { ok: false, reason: "rate_limited", retryAfter: byIp.retryAfter };

  const [byPair, byAccount] = await Promise.all([
    peekRateLimit(db, RATE_LIMITS.loginFailuresPerAccountAndIp, pair, now),
    peekRateLimit(db, RATE_LIMITS.loginFailuresPerAccount, email, now),
  ]);
  if (!byPair.allowed || !byAccount.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfter: Math.max(byPair.retryAfter, byAccount.retryAfter),
    };
  }

  const admin = await verifyCredentials(db, email, password);
  if (!admin) {
    await Promise.all([
      checkRateLimit(db, RATE_LIMITS.loginFailuresPerAccountAndIp, pair, now),
      checkRateLimit(db, RATE_LIMITS.loginFailuresPerAccount, email, now),
    ]);
    return { ok: false, reason: "invalid" };
  }

  await resetRateLimit(db, RATE_LIMITS.loginFailuresPerAccountAndIp, pair);
  return { ok: true, admin };
}
