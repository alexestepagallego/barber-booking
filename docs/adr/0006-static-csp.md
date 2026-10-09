# ADR 0006: Static Content-Security-Policy instead of nonces

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

A strict CSP normally uses a per-request nonce, so that only the server's
own inline scripts run. This app uses Next.js 16 Cache Components, which
partially prerenders pages: a static shell built once, plus dynamic parts
streamed at request time. The Next.js docs are explicit that "Partial
Prerendering (PPR) is incompatible with nonce-based CSP since static shell
scripts won't have access to the nonce". A nonce would force every page to
render at request time, giving up the static shell and the cached
catalogue.

## Decision

A static CSP, sent from `next.config.ts` on every route
(`src/server/security/headers.ts`):

```
default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self';
connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com;
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

It comes with `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy` and
HSTS in production. Two path rules are stricter:

- `/manage/*` (URLs that contain a secret) gets `Referrer-Policy: no-referrer`
  and `X-Robots-Tag: noindex`.
- `/admin/*` gets `Referrer-Policy: same-origin` and `noindex`. With
  `no-referrer`, browsers send `Origin: null` on form posts, which broke
  same-origin checks. The E2E tests caught this.

## Consequences

- `'unsafe-inline'` scripts are allowed, so the CSP does not stop an XSS
  that manages to inject an inline script. That job falls on the other
  layers: React escapes all output, no `dangerouslySetInnerHTML` is used,
  and inputs are validated with Zod (names only allow letters).
- Everything else is still locked down. No third-party origins except
  Cloudflare Turnstile, no plugins, no framing (clickjacking), no forms
  posting elsewhere and no `<base>` hijacking. `'unsafe-eval'` is allowed
  only in development.
- `next.config.ts` headers are unit-tested with Next's
  `unstable_getResponseFromNextConfig`, and checked again on the production
  build by the E2E suite.
- Revisit if Next.js gains hash- or SRI-based CSP support that covers its
  own inline scripts while keeping prerendering (`experimental.sri` does
  not cover them today).
