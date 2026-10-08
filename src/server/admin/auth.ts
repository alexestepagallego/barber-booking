import { randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, lt } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { adminSessions, adminUsers } from "@/server/db/schema";
import { hashToken } from "@/server/security/tokens";

/**
 * Admin authentication core: passwords and sessions. No Next.js imports, so
 * it is unit-testable; src/server/admin/session.ts wraps it with cookies.
 * Design and threat model: docs/adr/0004-admin-authentication.md.
 */

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 12;

/** argon2id with the library defaults (m=19 MiB, t=2, p=1), OWASP's minimum recommendation. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

// A real argon2id hash of a random throwaway password. Checking against it
// when the email is unknown makes "no such user" take as long as "wrong
// password", so response times do not reveal which emails are admins.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash(randomBytes(16).toString("hex")));

export async function createAdminUser(
  db: Db,
  { email, name, password }: { email: string; name: string; password: string },
) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(adminUsers)
    .values({ email: email.trim().toLowerCase(), name, passwordHash })
    .onConflictDoUpdate({ target: adminUsers.email, set: { name, passwordHash } })
    .returning({ id: adminUsers.id, email: adminUsers.email, name: adminUsers.name });
  // Changing a password signs out every existing session of that account.
  if (user) await db.delete(adminSessions).where(eq(adminSessions.adminUserId, user.id));
  return user!;
}

/** Returns the user when email and password match, undefined otherwise (same timing either way). */
export async function verifyCredentials(db: Db, email: string, password: string) {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email.trim().toLowerCase()));

  const valid = await verify(user?.passwordHash ?? (await getDummyHash()), password).catch(
    () => false,
  );
  return user && valid ? { id: user.id, email: user.email, name: user.name } : undefined;
}

/** Starts a session. The returned token goes in the cookie; only its hash is stored. */
export async function createSession(db: Db, adminUserId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(adminSessions).values({ tokenHash: hashToken(token), adminUserId, expiresAt });
  await db.update(adminUsers).set({ lastLoginAt: now }).where(eq(adminUsers.id, adminUserId));
  return { token, expiresAt };
}

export async function findSession(db: Db, token: string, now = new Date()) {
  const [row] = await db
    .select({ id: adminUsers.id, email: adminUsers.email, name: adminUsers.name })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, now)));
  return row;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
}

export async function purgeExpiredSessions(db: Db, now = new Date()) {
  const deleted = await db
    .delete(adminSessions)
    .where(lt(adminSessions.expiresAt, now))
    .returning({ tokenHash: adminSessions.tokenHash });
  return deleted.length;
}
