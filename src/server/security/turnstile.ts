import { describeError } from "@/server/log";

/**
 * Cloudflare Turnstile: a privacy-friendly, mostly invisible bot check for
 * the public booking form. The browser widget produces a single-use token
 * and the server verifies it with Cloudflare before creating a booking.
 *
 * Verification is enforced when both TURNSTILE_SECRET_KEY and
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY are set. Without them, for example in local
 * development and in the test suite, the check is skipped (with a warning
 * in production). Cloudflare publishes test keys that always
 * pass or always fail, used by the E2E tests:
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */

export type TurnstileResult =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: "missing-token" | "invalid-token" | "unavailable" };

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[turnstile] ${message}`);
}

/**
 * Enforced only when BOTH keys are configured. A half configuration is
 * reported loudly instead of failing silently:
 * - secret without site key: the browser never renders the widget, so
 *   enforcing would reject every booking; it is skipped instead.
 * - site key without secret: the widget runs, but nothing is verified.
 */
export function isTurnstileEnabled(): boolean {
  const secret = Boolean(process.env.TURNSTILE_SECRET_KEY);
  const siteKey = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  if (secret !== siteKey) {
    warnOnce(
      secret
        ? "TURNSTILE_SECRET_KEY is set without NEXT_PUBLIC_TURNSTILE_SITE_KEY: bot check disabled."
        : "NEXT_PUBLIC_TURNSTILE_SITE_KEY is set without TURNSTILE_SECRET_KEY: tokens are not verified.",
    );
  } else if (!secret && process.env.NODE_ENV === "production") {
    warnOnce("No Turnstile keys configured: bookings are not bot-checked.");
  }
  return secret && siteKey;
}

export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !isTurnstileEnabled()) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "missing-token" };

  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({
        secret,
        response: token,
        ...(remoteIp !== "local" && { remoteip: remoteIp }),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as { success?: boolean };
    return body.success === true
      ? { ok: true, skipped: false }
      : { ok: false, reason: "invalid-token" };
  } catch (error) {
    // Fail closed: if Cloudflare cannot be reached, the booking is refused
    // with a "try again" message rather than letting unverified traffic in.
    console.error("[turnstile] verification unavailable", describeError(error));
    return { ok: false, reason: "unavailable" };
  }
}
