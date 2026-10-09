# Security

What is protected, against what, and how. Design decisions are in the ADRs;
this page is the overview and the runbook.

## Assets

1. **The schedule:** no double bookings, no lost changes.
2. **Customer data:** name, email and phone.
3. **Control of a booking:** whoever has a manage link can cancel or move it.
4. **The admin panel:** full control of the shop's catalogue and agenda.
5. **The shop's email reputation:** the booking form sends emails to
   addresses typed by strangers.

## Threats and controls

| Threat                                    | Controls                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two customers get the same time           | Exclusion constraint + per-barber advisory lock, proven by concurrency tests ([concurrency.md](concurrency.md))                                                                                                                                                                                                                                                    |
| Concurrent changes overwrite each other   | Conditional `UPDATE`s that compare status, start time and barber; the loser gets a clear error                                                                                                                                                                                                                                                                     |
| Guessing or brute-forcing manage links    | 256-bit HMAC tokens ([ADR 0003](adr/0003-hmac-derived-manage-links.md)), identical 404s for malformed and unknown tokens, per-IP rate limits on the `/api/manage/*` endpoints                                                                                                                                                                                      |
| Manage links leaking                      | Token sent in `Authorization` (not in API URLs); `Referrer-Policy: no-referrer` and `noindex` on `/manage/*`; static page title; never in caches, cache keys or logs                                                                                                                                                                                               |
| Database dump                             | Only hashes of manage tokens, session tokens and idempotency keys (the latter are cleared by the nightly cron once older than 24 h, after which a replay cannot recover someone's manage link); argon2id passwords; personal data erased after the retention period                                                                                                |
| Admin account takeover                    | argon2id, timing-safe login, rate limits per IP on every attempt and on **failures only** per account (+IP), so a stranger cannot lock the owner out; `httpOnly`/`Secure`/`SameSite=Lax` cookie scoped to `/admin`; server-side session revocation ([ADR 0004](adr/0004-admin-authentication.md))                                                                  |
| Reaching admin features without a session | A session check inside every admin page (`requireAdminPage()`), every Server Action except login (`requireAdmin()`) and the availability route handler (`getAdmin()`, 401), not only in `proxy.ts` or layouts. E2E tests check that the panel is unreachable without a session                                                                                     |
| CSRF                                      | `SameSite=Lax`; Server Actions check `Origin`; logout and the manage APIs only accept same-origin POSTs or bearer tokens                                                                                                                                                                                                                                           |
| Using the booking form to spam an inbox   | Cloudflare Turnstile (fails closed), honeypot field, 10 validated booking requests per IP per hour (IPv6 counted per /64), max 5 confirmations per inbox per day (`+tags` and Gmail dots normalised), charged only after the bot check and only for created bookings, so nobody can use up a customer's budget ([ADR 0005](adr/0005-rate-limiting-in-postgres.md)) |
| Email content injection                   | React Email escapes all values; customer names must start with a letter and may only contain letters (any script), spaces and `' ’ . -`, so no URLs end up in greetings                                                                                                                                                                                            |
| XSS / clickjacking                        | React escaping, no `dangerouslySetInnerHTML`, CSP with `object-src 'none'`, `frame-ancestors 'none'`, `base-uri` and `form-action` locked ([ADR 0006](adr/0006-static-csp.md))                                                                                                                                                                                     |
| Leaking internals in errors               | One error mapper: domain errors become clear 4xx; anything else becomes a generic 500                                                                                                                                                                                                                                                                              |
| Personal data in logs                     | Errors in route handlers and Server Actions are logged through `describeError()`: database errors only log the SQLSTATE and constraint name, never Drizzle's message, which includes query parameters                                                                                                                                                              |
| Unauthorized cron calls                   | `Bearer $CRON_SECRET`, compared in constant time; closed when the secret is not set                                                                                                                                                                                                                                                                                |

## Secrets

| Variable               | Used for                   | If it leaks                                                                        |
| ---------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`         | everything                 | rotate in Neon; assume the data was read                                           |
| `MANAGE_LINK_SECRET`   | deriving manage links      | rotate (below); all links stop working                                             |
| `CRON_SECRET`          | authenticating Vercel Cron | rotate in Vercel; worst case, extra reminder or maintenance runs (both idempotent) |
| `RESEND_API_KEY`       | sending email              | revoke in Resend                                                                   |
| `TURNSTILE_SECRET_KEY` | bot checks                 | rotate in Cloudflare                                                               |
| `DEMO_ADMIN_PASSWORD`  | public demo only           | public by design; the demo resets nightly                                          |

### Rotating `MANAGE_LINK_SECRET`

Use this if links may have been exposed in bulk (for example a leaked email
log):

1. Set a new value in Vercel (`openssl rand -base64 48`) and redeploy. From
   now on, every existing link returns 404.
2. Run `npm run tokens:rehash` against the production database (with
   `DATABASE_URL` and the **new** secret in the environment). It recomputes
   every stored hash.
3. New emails (reminders, changes) carry working links again. Customers who
   need a link sooner can get one from the shop: the admin appointment page
   shows the current link.

## Privacy (GDPR)

- Legal basis: the booking itself (art. 6.1.b). No marketing, no tracking
  cookies, no analytics.
- Data minimisation: name, email and phone are erased automatically after
  `DATA_RETENTION_DAYS`, by the nightly cron.
- Transparency: `/privacy` reads the retention period and the shop's
  contact details from the live configuration, so it cannot drift from
  what the system does. It is a starting point; a real shop should have it
  reviewed.
- Processors: Vercel (hosting), Neon (database), Resend (email) and
  Cloudflare (Turnstile).

## Known limitations

- The CSP allows inline scripts (a consequence of prerendering; see
  ADR 0006).
- The admin panel has no 2FA and no password reset by email: the owner
  resets passwords with the CLI.
- Unknown manage links are soft 404s (HTTP 200 + `noindex`): a streaming
  trade-off.
- An email can be lost if the server process dies between the commit and
  the send ([ADR 0007](adr/0007-emails-after-response.md)).

## Reporting a vulnerability

Please open a private security advisory on GitHub rather than a public
issue.
