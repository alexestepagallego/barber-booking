/**
 * Runtime configuration read from environment variables, in one place.
 * Every value is read lazily (at call time), so importing this module never
 * fails during `next build` and tests can change process.env freely.
 * The full list, with examples, lives in .env.example and docs/deployment.md.
 */

/** Public base URL used in email links, without a trailing slash. */
export function appUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  // Set automatically by Vercel for production deployments.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** Sender address, e.g. "Chane Barber <bookings@mail.example.com>". */
export function emailFrom(): string {
  return process.env.EMAIL_FROM ?? "Chane Barber <bookings@example.com>";
}

/**
 * Public demo: shows a banner and the demo credentials, and enables the
 * nightly reset. NEXT_PUBLIC_ so the banner can be part of the static shell
 * (it is inlined at build time; changing it needs a redeploy).
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

/** Throwaway admin account for the public demo, recreated every night. */
export function demoAdmin(): { email: string; password: string } | null {
  const email = process.env.DEMO_ADMIN_EMAIL;
  const password = process.env.DEMO_ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

/** How long customer personal data is kept after an appointment, in days. */
export function retentionDays(): number {
  const days = Number(process.env.DATA_RETENTION_DAYS ?? 365);
  return Number.isFinite(days) && days > 0 ? days : 365;
}
