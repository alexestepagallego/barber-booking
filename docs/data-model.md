# Data model

PostgreSQL 17, managed with Drizzle (`src/server/db/schema.ts`) and plain
SQL migrations (`drizzle/`). Rules that must never break are enforced by
the database itself, with constraints and checks, so no code path can skip
them.

```mermaid
erDiagram
    shop_settings {
        smallint id PK "always 1"
        text name
        text phone
        text address
        text timezone "IANA, e.g. Europe/Madrid"
        smallint slot_interval_minutes
        smallint booking_horizon_days
        int min_notice_minutes
        int cancellation_cutoff_minutes
    }
    barbers {
        uuid id PK
        text slug UK
        text name
        bool active
    }
    services {
        uuid id PK
        text slug UK
        text name
        smallint duration_minutes
        int price_cents
        bool active
    }
    barber_services {
        uuid barber_id PK, FK
        uuid service_id PK, FK
    }
    working_hours {
        uuid id PK
        uuid barber_id FK
        smallint weekday "1=Mon … 7=Sun"
        time start_time "wall clock"
        time end_time
    }
    time_off {
        uuid id PK
        uuid barber_id FK "NULL = whole shop"
        timestamptz starts_at
        timestamptz ends_at
    }
    appointments {
        uuid id PK
        uuid barber_id FK
        uuid service_id FK
        text customer_name
        text customer_email
        text customer_phone
        timestamptz starts_at
        timestamptz ends_at
        enum status "confirmed|cancelled|completed|no_show"
        text manage_token_hash UK
        uuid idempotency_key UK
        timestamptz reminder_sent_at
    }
    appointment_events {
        bigint id PK
        uuid appointment_id FK
        enum type
        enum actor "customer|admin|system"
        jsonb data
    }
    admin_users {
        uuid id PK
        text email UK "lower-case"
        text password_hash "argon2id"
    }
    admin_sessions {
        text token_hash PK
        uuid admin_user_id FK
        timestamptz expires_at
    }
    rate_limits {
        text key PK
        int count
        timestamptz reset_at
    }

    barbers ||--o{ barber_services : offers
    services ||--o{ barber_services : "offered by"
    barbers ||--o{ working_hours : works
    barbers ||--o{ time_off : "is away"
    barbers ||--o{ appointments : serves
    services ||--o{ appointments : "is booked as"
    appointments ||--o{ appointment_events : "history"
    admin_users ||--o{ admin_sessions : "signs in"
```

## Invariants enforced by the database

| Invariant                                                    | How                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A barber never has two overlapping confirmed appointments    | `appointments_no_overlap`: `EXCLUDE USING gist (barber_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE status = 'confirmed'` ([ADR 0001](adr/0001-database-enforced-no-overlap.md)) |
| Appointments end after they start                            | `CHECK (ends_at > starts_at)` (also on `time_off` and `working_hours`)                                                                                                                            |
| `cancelled_at` is set exactly when the status is `cancelled` | `CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))`                                                                                                                                     |
| One booking per idempotency key                              | `UNIQUE (idempotency_key)`                                                                                                                                                                        |
| One shop settings row                                        | `CHECK (id = 1)`                                                                                                                                                                                  |
| Sensible services                                            | duration 1–480 min, price ≥ 0                                                                                                                                                                     |
| Admin emails are lower-case and unique                       | `CHECK (email = lower(email))` + `UNIQUE`                                                                                                                                                         |
| No deleting history by accident                              | `ON DELETE RESTRICT` from appointments to barbers and services: deactivate instead                                                                                                                |

## Design notes

- **Wall-clock vs instants.** Working hours are `time` columns, wall-clock
  times in the shop's zone, because the shop opens at 9 in summer and in
  winter. Everything that happens at a point in time is `timestamptz`.
  [availability.md](availability.md) explains the conversion.
- **Durations are fixed at booking time.** `ends_at` is stored, so changing
  a service's duration later never moves existing appointments.
- **Append-only history.** `appointment_events` records who did what
  (`customer`, `admin`, `system`) and is shown on the admin appointment
  page. Concurrency tests check that the history always matches the row.
- **Secrets are hashes.** Manage-link tokens and admin session tokens are
  stored only as SHA-256 hashes, and passwords as argon2id hashes.
- **Data minimisation.** The maintenance cron overwrites customer name,
  email and phone once an appointment is older than `DATA_RETENTION_DAYS`
  (default 365). The anonymous appointment stays for the agenda history.

## Migrations

| File                                   | Adds                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `0000_initial_schema.sql`              | catalogue, schedule, appointments, events                                         |
| `0001_no_overlapping_appointments.sql` | `btree_gist` + the exclusion constraint (hand-written: Drizzle cannot express it) |
| `0002_shop_contact_details.sql`        | shop phone and address                                                            |
| `0003_admin_auth_and_rate_limits.sql`  | admin users, sessions, rate-limit counters                                        |

`npm run db:generate` creates a migration from schema changes. CI fails if
the schema and the migrations drift apart.
