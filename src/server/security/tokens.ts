import { createHash, randomBytes } from "node:crypto";

/** SHA-256 hex digest. Only hashes are stored, so a leaked database does not leak working links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates the secret for a "manage your booking" link: 32 random bytes
 * (256 bits) encoded as base64url so it is safe to put in a URL path.
 */
export function generateManageToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
