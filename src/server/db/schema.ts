import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Column names are written in camelCase here and mapped to snake_case in SQL
// (`casing: "snake_case"` in both drizzle.config.ts and the db client).

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Single-row table with the shop-wide booking policy.
 * The `id = 1` check makes a second row impossible.
 */
export const shopSettings = pgTable(
  "shop_settings",
  {
    id: smallint().primaryKey().default(1),
    name: text().notNull(),
    /** Shown to customers who can no longer change a booking online, and in emails. */
    phone: text(),
    /** Used as the location of calendar invites. */
    address: text(),
    /** IANA time zone used to interpret working hours, e.g. "Europe/Madrid". */
    timezone: text().notNull(),
    /** Candidate start times are generated every N minutes. */
    slotIntervalMinutes: smallint().notNull().default(15),
    /** How far into the future customers can book. */
    bookingHorizonDays: smallint().notNull().default(60),
    /** Minimum time between "now" and the start of a new booking. */
    minNoticeMinutes: integer().notNull().default(60),
    /** Customers can cancel or reschedule until this long before the start. */
    cancellationCutoffMinutes: integer().notNull().default(120),
    ...timestamps,
  },
  (t) => [
    check("shop_settings_singleton", sql`${t.id} = 1`),
    check("shop_settings_slot_interval_positive", sql`${t.slotIntervalMinutes} > 0`),
    check("shop_settings_horizon_positive", sql`${t.bookingHorizonDays} > 0`),
    check("shop_settings_min_notice_non_negative", sql`${t.minNoticeMinutes} >= 0`),
    check("shop_settings_cutoff_non_negative", sql`${t.cancellationCutoffMinutes} >= 0`),
  ],
);

export const barbers = pgTable("barbers", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  bio: text(),
  active: boolean().notNull().default(true),
  sortOrder: smallint().notNull().default(0),
  ...timestamps,
});

export const services = pgTable(
  "services",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    durationMinutes: smallint().notNull(),
    priceCents: integer().notNull(),
    active: boolean().notNull().default(true),
    sortOrder: smallint().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check("services_duration_range", sql`${t.durationMinutes} > 0 AND ${t.durationMinutes} <= 480`),
    check("services_price_non_negative", sql`${t.priceCents} >= 0`),
  ],
);

/** Which services each barber offers. */
export const barberServices = pgTable(
  "barber_services",
  {
    barberId: uuid()
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    serviceId: uuid()
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.barberId, t.serviceId] })],
);

/**
 * Weekly schedule. Several rows per barber and weekday allow split shifts
 * (e.g. 09:00–13:30 and 16:00–20:00). Times are wall-clock times in the
 * shop's time zone, so they survive daylight-saving changes.
 */
export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid().primaryKey().defaultRandom(),
    barberId: uuid()
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: smallint().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
  },
  (t) => [
    check("working_hours_weekday_range", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("working_hours_valid_range", sql`${t.endTime} > ${t.startTime}`),
    index("working_hours_barber_weekday_idx").on(t.barberId, t.weekday),
  ],
);

/**
 * Absences and closures. `barberId = null` closes the whole shop
 * (public holidays); otherwise it only blocks that barber (vacation).
 */
export const timeOff = pgTable(
  "time_off",
  {
    id: uuid().primaryKey().defaultRandom(),
    barberId: uuid().references(() => barbers.id, { onDelete: "cascade" }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    reason: text(),
    ...timestamps,
  },
  (t) => [
    check("time_off_valid_range", sql`${t.endsAt} > ${t.startsAt}`),
    index("time_off_barber_range_idx").on(t.barberId, t.startsAt, t.endsAt),
  ],
);

export const appointmentStatus = pgEnum("appointment_status", [
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);

/**
 * The no-double-booking guarantee does NOT live in this file: it is an
 * exclusion constraint (`appointments_no_overlap`) added by a hand-written
 * migration, because Drizzle cannot express `EXCLUDE USING gist` yet.
 * See drizzle/0001_no_overlapping_appointments.sql and docs/concurrency.md.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid().primaryKey().defaultRandom(),
    barberId: uuid()
      .notNull()
      .references(() => barbers.id, { onDelete: "restrict" }),
    serviceId: uuid()
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    customerName: text().notNull(),
    customerEmail: text().notNull(),
    customerPhone: text().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    status: appointmentStatus().notNull().default("confirmed"),
    /** SHA-256 of the secret sent in the "manage your booking" link. */
    manageTokenHash: text().notNull(),
    /**
     * SHA-256 of the client's Idempotency-Key. Only the hash is stored: a
     * replay returns the manage link, so a copy of the database must not be
     * enough to replay someone else's booking. Cleared after 24 h.
     */
    idempotencyKeyHash: text(),
    /** Price at booking time: later price changes never alter existing appointments. */
    priceCents: integer().notNull(),
    cancelledAt: timestamp({ withTimezone: true }),
    reminderSentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("appointments_valid_range", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "appointments_cancelled_at_matches_status",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)`,
    ),
    unique("appointments_manage_token_hash_unique").on(t.manageTokenHash),
    unique("appointments_idempotency_key_hash_unique").on(t.idempotencyKeyHash),
    index("appointments_starts_at_idx").on(t.startsAt),
  ],
);

export const appointmentEventType = pgEnum("appointment_event_type", [
  "created",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
  "reminder_sent",
]);

export const actorType = pgEnum("actor_type", ["customer", "admin", "system"]);

/** Append-only history of everything that happens to an appointment. */
export const appointmentEvents = pgTable(
  "appointment_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    appointmentId: uuid()
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    type: appointmentEventType().notNull(),
    actor: actorType().notNull(),
    data: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("appointment_events_appointment_idx").on(t.appointmentId)],
);

export type Barber = typeof barbers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;

/** Staff who can sign in to /admin. Created from the CLI (npm run admin:create), never via sign-up. */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Always stored lower-cased. */
    email: text().notNull(),
    name: text().notNull(),
    /** argon2id hash (PHC string), never the password. */
    passwordHash: text().notNull(),
    lastLoginAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("admin_users_email_unique").on(t.email),
    check("admin_users_email_lowercase", sql`${t.email} = lower(${t.email})`),
  ],
);

/**
 * Server-side sessions. The cookie holds a random 256-bit token; this table
 * stores only its SHA-256, so a database leak does not leak live sessions.
 * Logging out (or deleting the row) revokes a session immediately.
 */
export const adminSessions = pgTable(
  "admin_sessions",
  {
    tokenHash: text().primaryKey(),
    adminUserId: uuid()
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_sessions_user_idx").on(t.adminUserId)],
);

/**
 * Fixed-window rate-limit counters, shared by every app instance.
 * `key` combines the rule and the subject, e.g. "booking:ip:203.0.113.7".
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().primaryKey(),
    count: integer().notNull(),
    resetAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_reset_at_idx").on(t.resetAt)],
);

export type AdminUser = typeof adminUsers.$inferSelect;
