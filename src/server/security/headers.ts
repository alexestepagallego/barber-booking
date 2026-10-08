/**
 * HTTP security headers, applied to every route from next.config.ts.
 *
 * The Content-Security-Policy is static, not nonce-based: with Cache
 * Components the pages are partially prerendered, and a prerendered static
 * shell cannot carry a per-request nonce (Next.js docs: "PPR is
 * incompatible with nonce-based CSP"). So inline scripts must be allowed,
 * but everything else is locked down: no third-party origins except
 * Cloudflare Turnstile, no plugins, no framing, no foreign form targets.
 * See docs/adr/0006-static-csp.md and docs/security.md.
 */

const TURNSTILE = "https://challenges.cloudflare.com";

export function contentSecurityPolicy(dev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' only in development: React's dev tooling needs it.
    "script-src": ["'self'", "'unsafe-inline'", TURNSTILE, ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "media-src": ["'self'"],
    // ws: for hot reloading in development.
    "connect-src": ["'self'", TURNSTILE, ...(dev ? ["ws:"] : [])],
    "frame-src": [TURNSTILE],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(dev ? {} : { "upgrade-insecure-requests": [] }),
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

type Header = { key: string; value: string };

export function securityHeaders(dev: boolean): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()",
    },
    ...(dev
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  ];
}

/**
 * Pages whose URL is a secret (manage links) or that are staff-only: never
 * send the URL in Referer, never index them.
 */
export const privatePageHeaders: Header[] = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];
