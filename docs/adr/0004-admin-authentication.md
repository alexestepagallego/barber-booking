# ADR 0004: Own database sessions for the admin panel

- **Status:** Accepted
- **Date:** 2026-10-08 (supersedes the plan to use Auth.js)

## Context

Only shop staff sign in, with email and password; customers never do.
Accounts are created by the shop owner, never by self sign-up. The
original plan was Auth.js, but its Next.js 16-compatible major version
(v5) was still in beta, and its credentials provider is discouraged and
works only with JWT sessions, which cannot be revoked server-side.
Better Auth was the other candidate: capable, but it brings its own
tables, plugins and conventions for a feature this small.

## Decision

A small, fully reviewable implementation (~150 lines) of the standard
pattern from the Next.js authentication guide:

| Concern          | Implementation                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage | argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1: the OWASP minimum), minimum 12 characters                                                                                 |
| Login timing     | an unknown email is verified against a dummy hash, so response time does not reveal which emails exist                                                                     |
| Brute force      | rate limits per IP (20 per 15 min) and per account (5 per 15 min), with the same answer either way                                                                         |
| Sessions         | random 256-bit token in an `httpOnly`, `SameSite=Lax`, `Secure` cookie with `path=/admin`. The `admin_sessions` table stores only its SHA-256 hash, with a 7-day expiry    |
| Revocation       | logout deletes the row; changing a password deletes all of that admin's sessions                                                                                           |
| Authorization    | `requireAdmin()` (Data Access Layer) at the top of every admin page, Server Action and route handler. `proxy.ts` only does an optimistic "no cookie → login page" redirect |
| CSRF             | `SameSite=Lax` cookie; Server Actions check `Origin`; logout is a same-origin POST                                                                                         |
| Accounts         | `npm run admin:create` with the password in an env var (not in shell history)                                                                                              |

## Consequences

- Every line of the auth path is in this repository and covered by tests:
  integration tests for hashing, sessions, expiry and revocation, and E2E
  tests for login, wrong password, access without a session and logout.
- No password reset by email and no 2FA. For a single shop, the owner
  resets a password with the CLI. Both would be the first additions if the
  panel grew to many staff accounts.
- Logout is a plain form POST with a full page load, on purpose: Next.js 16
  keeps previous pages alive with `<Activity>`, and a full load guarantees
  no admin UI state survives the logout.
