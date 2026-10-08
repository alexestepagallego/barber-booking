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
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response("Forbidden", { status: 403 });
  }
  await endSession();
  return Response.redirect(new URL("/admin/login", request.url), 303);
}
