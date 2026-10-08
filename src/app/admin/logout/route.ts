import { endSession } from "@/server/admin/session";

/**
 * POST /admin/logout — a plain form post, so the browser does a full page
 * load afterwards. That matters in Next.js 16: client navigations keep
 * previous pages alive (<Activity>), and a full load guarantees no admin UI
 * state survives the logout.
 */
export async function POST(request: Request) {
  // Only accept same-origin posts. The SameSite=Lax cookie already stops
  // cross-site requests from carrying the session; this is belt and braces.
  // Compared with the Host header rather than request.url, which behind a
  // proxy (or `next start` bound to 0.0.0.0) may not be the public origin.
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  await endSession();
  // A relative Location is valid HTTP (RFC 9110) and avoids depending on
  // request.url, which is not always absolute in route handlers.
  return new Response(null, { status: 303, headers: { Location: "/admin/login" } });
}

/** Accepts requests without an Origin header (older browsers) or with one matching our host. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    // "null" (privacy-sensitive contexts) or garbage: not provably same-origin.
    return false;
  }
}
