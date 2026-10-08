import { describeError } from "@/server/log";

/**
 * Cloudflare Turnstile: a privacy-friendly, mostly invisible bot check for
 * the public booking form. The browser widget produces a single-use token
 * and the server verifies it with Cloudflare before creating a booking.
 *
 * Verification is enforced whenever TURNSTILE_SECRET_KEY is set (always in
 * production). Without it, for example in local development and in the test
 * suite, the check is skipped. Cloudflare publishes test keys that always
 * pass or always fail, used by the E2E tests:
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */

export type TurnstileResult =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: "missing-token" | "invalid-token" | "unavailable" };

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
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
