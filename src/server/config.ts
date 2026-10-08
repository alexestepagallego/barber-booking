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

/** Public demo: shows a banner and demo credentials, and allows the nightly reset. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

/** How long customer personal data is kept after an appointment, in days. */
export function retentionDays(): number {
  const days = Number(process.env.DATA_RETENTION_DAYS ?? 365);
  return Number.isFinite(days) && days > 0 ? days : 365;
}
