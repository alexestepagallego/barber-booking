import { createHash, createHmac } from "node:crypto";

/** SHA-256 hex digest. Only hashes are stored, so a leaked database does not leak working links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const DEV_SECRET = "development-only-manage-link-secret-do-not-use-in-production";

/**
 * Secret used to derive manage-link tokens. Required in production. Rotating
 * it invalidates every existing manage link at once (the emergency brake).
 */
export function getManageLinkSecret(): string {
  const secret = process.env.MANAGE_LINK_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MANAGE_LINK_SECRET must be set to at least 32 characters in production");
  }
  return DEV_SECRET;
}

/**
 * The secret for an appointment's "manage your booking" link:
 * base64url(HMAC-SHA256(secret, "manage:" + appointmentId)), 43 characters.
 *
 * Deriving it, instead of generating random bytes, lets the server rebuild
 * the link whenever it needs one (reminder, reschedule and admin emails)
 * while still storing only its hash. Without the server secret, a copy of
 * the database is not enough to forge or recover any link.
 * See docs/adr/0003-hmac-derived-manage-links.md.
 */
export function deriveManageToken(appointmentId: string, secret = getManageLinkSecret()): string {
  return createHmac("sha256", secret).update(`manage:${appointmentId}`).digest("base64url");
}
