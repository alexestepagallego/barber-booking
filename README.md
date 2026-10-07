# barber-booking

[![CI](https://github.com/alexestepagallego/barber-booking/actions/workflows/ci.yml/badge.svg)](https://github.com/alexestepagallego/barber-booking/actions/workflows/ci.yml)

Online booking for a barbershop, built to production standards. It is
based on the real shop [Chane Barber](https://github.com/alexestepagallego/chanebarber).

> 🚧 **Work in progress.** The booking engine (data model, double-booking
> protection, availability and their tests) is done. The booking UI, the
> manage-your-booking links, emails and the admin panel are next. See the
> [roadmap](#roadmap).

## Highlights

- **No double bookings, proven under concurrency.** A PostgreSQL exclusion
  constraint makes overlapping appointments impossible, and a per-barber
  advisory lock keeps concurrent requests from deadlocking each other. The
  test suite fires up to 100 simultaneous bookings at a real database and
  checks the invariant. [How it works →](docs/concurrency.md)
- **Daylight-saving safe availability.** Opening hours are stored as
  wall-clock times in the shop's time zone and turned into exact instants
  per day, so "we open at 9" is right all year. Tested on both transition
  days. [How it works →](docs/availability.md)
- **Services with real durations.** A 15-minute beard trim and a 45-minute
  cut + beard occupy exactly their time; there is no fixed slot grid.
- **Idempotent bookings.** A double tap or a network retry returns the same
  booking instead of an error or a duplicate.
- **Secrets stored as hashes.** "Manage your booking" links carry a 256-bit
  random token. Only its SHA-256 hash is stored, so a database leak does not
  leak working links.

## Tech stack

|           |                                                                     |
| --------- | ------------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict)              |
| Database  | PostgreSQL 17 + Drizzle ORM (Neon in production)                    |
| Styling   | Tailwind CSS 4                                                      |
| Tests     | Vitest: unit, integration and concurrency against real Postgres     |
| CI        | GitHub Actions: format, lint, typecheck, schema drift, tests, build |

## Getting started

Requirements: Node.js 24+ and PostgreSQL 17, either through Docker or a
local install.

```bash
git clone https://github.com/alexestepagallego/barber-booking.git
cd barber-booking
npm install
cp .env.example .env.local

docker compose up -d          # or use your own Postgres and edit .env.local

npm run db:migrate            # dev database
npm run db:migrate -- --test  # test database
npm run db:seed               # demo barbers, services and opening hours

npm run dev                   # http://localhost:3000
```

### Scripts

| Command                                 | What it does                                               |
| --------------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                           | Start the dev server                                       |
| `npm test`                              | Run all tests (unit + integration)                         |
| `npm run test:unit`                     | Fast tests, no database                                    |
| `npm run test:integration`              | Database and concurrency tests (needs `TEST_DATABASE_URL`) |
| `npm run lint` / `typecheck` / `format` | Code quality                                               |
| `npm run db:generate`                   | Create a migration from schema changes                     |
| `npm run db:migrate`                    | Apply migrations                                           |
| `npm run db:seed`                       | Load demo data (idempotent)                                |
| `npm run db:studio`                     | Browse the database                                        |

## Project structure

```
drizzle/                 SQL migrations (0001 adds the no-overlap constraint)
src/app/                 Next.js routes
src/server/db/           schema, client, migrations runner, seed
src/server/booking/      booking logic: availability engine, repository, schedule lock
src/server/security/     token generation and hashing
tests/unit/              pure logic
tests/integration/       real-database tests, including concurrency
docs/                    architecture notes and decision records
```

## Documentation

- [How double bookings are prevented](docs/concurrency.md)
- [How availability is computed](docs/availability.md)
- [ADR 0001: Enforce "no overlap" in the database](docs/adr/0001-database-enforced-no-overlap.md)
- [ADR 0002: Per-barber advisory lock](docs/adr/0002-per-barber-advisory-lock.md)

## Roadmap

- [x] Project setup, CI, Docker Compose
- [x] Data model, no-overlap constraint, concurrency tests
- [x] Availability engine (split shifts, holidays, DST-safe)
- [ ] Public booking flow
- [ ] Manage-your-booking link (cancel / reschedule)
- [ ] Confirmation and reminder emails with calendar invite
- [ ] Admin panel
- [ ] Rate limiting, bot protection, E2E tests
- [ ] Public demo on Vercel
