import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { getDb } from "@/server/db/client";

import { createSession, deleteSession, findSession } from "./auth";

/**
 * Data Access Layer for the admin session (the pattern recommended by the
 * Next.js authentication guide). Every admin page, Server Action and route
 * handler calls requireAdmin(): proxy.ts only does an optimistic
 * cookie-presence redirect, and layouts are not a security boundary.
 */

export const SESSION_COOKIE = "bb_admin_session";

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  // The cookie is only ever sent to /admin, never to the public pages.
  path: "/admin",
  expires,
});

export type AdminIdentity = { id: string; email: string; name: string };

/** The signed-in admin, or null. Memoised per render pass with React cache(). */
export const getAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return (await findSession(getDb(), token)) ?? null;
});

/** Use at the start of every admin page, action and handler. */
export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/**
 * For admin pages: marks the render as request-time first (the pages read
 * the clock and live data), then checks the session.
 */
export async function requireAdminPage(): Promise<AdminIdentity> {
  await connection();
  return requireAdmin();
}

/** Only callable from a Server Action or route handler (cookies can't be set during render). */
export async function startSession(adminUserId: string) {
  const { token, expiresAt } = await createSession(getDb(), adminUserId);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  store.delete({ name: SESSION_COOKIE, path: "/admin" });
}

/** Request headers for rate limiting inside Server Actions. */
export async function requestHeaders(): Promise<Headers> {
  return new Headers(await headers());
}
