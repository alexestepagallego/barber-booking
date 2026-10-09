# Deployment

The app is built for **Vercel + Neon (PostgreSQL) + Resend + Cloudflare
Turnstile**. Every service has a free tier that covers a single shop. It
also runs anywhere `next start` runs, with any PostgreSQL 14+ that has the
`btree_gist` extension.

## 1. Database (Neon)

1. Create a Neon project in the EU region closest to the shop (for example
   Frankfurt). The easiest route is from Vercel: **Storage → Create
   Database → Neon**, which also injects `DATABASE_URL` into the project.
2. Use the **pooled** connection string for `DATABASE_URL`.
3. Nothing to enable by hand: migration `0001` runs
   `CREATE EXTENSION IF NOT EXISTS btree_gist`, which Neon supports.

## 2. Vercel project

1. Import the GitHub repository in Vercel. The framework is detected
   automatically.
2. `vercel.json` already sets:
   - **Build command:** `npm run db:migrate && npm run build`, so
     migrations are applied on every deploy before the new code goes live.
     For preview deployments, use Neon's Vercel integration with database
     branching, so previews never migrate production.
   - **Crons:** reminders daily at 16:00 UTC, maintenance at 02:30 UTC.
     The Hobby plan allows daily crons, which is all this app needs.
3. Add the environment variables below, then deploy.

### Environment variables

| Variable                                  | Required    | Value                                                                              |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                            | yes         | Neon pooled connection string                                                      |
| `MANAGE_LINK_SECRET`                      | yes         | `openssl rand -base64 48` (at least 32 characters)                                 |
| `CRON_SECRET`                             | yes         | `openssl rand -base64 32` (Vercel sends it to the crons automatically)             |
| `APP_URL`                                 | recommended | `https://your-domain`. Without it, Vercel's production domain is used              |
| `RESEND_API_KEY`                          | for emails  | from Resend, after verifying the domain (below)                                    |
| `EMAIL_FROM`                              | for emails  | `Chane Barber <bookings@mail.your-domain>`                                         |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`          | recommended | Cloudflare Turnstile site key (rebuild after changing it: it is inlined)           |
| `TURNSTILE_SECRET_KEY`                    | recommended | Cloudflare Turnstile secret                                                        |
| `DATA_RETENTION_DAYS`                     | no          | default `365`                                                                      |
| `NEXT_PUBLIC_DEMO_MODE`                   | demo only   | `true` for the public demo, **never for a real shop** (it resets all data nightly) |
| `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` | demo only   | throwaway credentials shown on the login page                                      |

## 3. Email (Resend)

1. In Resend, add a sending **subdomain**, for example `mail.your-domain`.
   Keeping transactional mail on a subdomain protects the main domain's
   reputation.
2. Resend shows the DNS records to create at your DNS provider: an MX and
   a TXT (SPF) record for bounces, a TXT DKIM record, and optionally DMARC.
   Wait until all of them show as **Verified**.
3. Create an API key with "sending access" only, and set `RESEND_API_KEY`
   and `EMAIL_FROM`.
4. Without a key, the app still works: emails are only logged.

## 4. Bot protection (Turnstile)

Create a Turnstile widget for your domain in Cloudflare (mode "Managed"),
then set both keys. Verification is enforced whenever the secret is set,
and fails closed if Cloudflare cannot be reached.

## 5. First admin

Run once against the production database, from your machine:

```bash
DATABASE_URL='<neon connection string>' ADMIN_PASSWORD='<a long passphrase>' npm run admin:create -- owner@your-domain "Owner Name"
```

Then sign in at `/admin/login`. Configure the real shop name, phone and
address in **Settings**, and opening hours in **Hours & time off**.

## 6. Smoke test after deploying

```bash
curl -sI https://your-domain | grep -i content-security-policy
curl -s -o /dev/null -w "%{http_code}\n" https://your-domain/api/cron/reminders   # 401
```

Then book an appointment, open the manage link from the email, move it,
and cancel it.

## Public demo

Same steps with `NEXT_PUBLIC_DEMO_MODE=true` and the demo credentials. To
fill it straight away instead of waiting for the nightly run:

```bash
DATABASE_URL='<demo database>' DEMO_ADMIN_EMAIL=… DEMO_ADMIN_PASSWORD=… npm run demo:reset -- --yes
```

## Self-hosting

`npm run build && npm start` behind a reverse proxy with HTTPS. Without
Vercel Cron, call both cron endpoints from any scheduler (for example
system cron with `curl -H "Authorization: Bearer $CRON_SECRET"`). With
more than one instance, also set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` and
a shared cache handler, as the Next.js self-hosting guide describes.
