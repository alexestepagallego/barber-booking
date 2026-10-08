import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { isConstraintViolation, PG_ERROR } from "@/server/db/errors";
import { withTransactionRetry } from "@/server/db/retry";
import { appointmentEvents, appointments, type Appointment } from "@/server/db/schema";
import { deriveManageToken, hashToken } from "@/server/security/tokens";

import { SlotUnavailableError } from "./errors";
import { lockBarberSchedule } from "./schedule-lock";

/** Defined in drizzle/0001_no_overlapping_appointments.sql. */
export const NO_OVERLAP_CONSTRAINT = "appointments_no_overlap";
const IDEMPOTENCY_CONSTRAINT = "appointments_idempotency_key_unique";

export type AppointmentInput = {
  barberId: string;
  serviceId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  startsAt: Date;
  endsAt: Date;
  idempotencyKey?: string;
  actor: "customer" | "admin";
};

export type InsertResult = {
  appointment: Appointment;
  /** Secret for the manage link. Never stored: only its hash is. */
  manageToken: string;
  /** True when this was a retry of a request that had already succeeded. */
  replayed: boolean;
};

/**
 * Inserts a confirmed appointment and its "created" event atomically.
 *
 * There is deliberately no "is this slot free?" query before the insert:
 * that check would race with concurrent requests. The database's exclusion
 * constraint is the single arbiter, so if two requests target overlapping
 * times for the same barber, exactly one INSERT succeeds and the other gets
 * SQLSTATE 23P01, which we translate into SlotUnavailableError.
 *
 * Before inserting, the transaction takes a per-barber advisory lock so
 * concurrent bookings for the same barber queue up instead of deadlocking
 * each other (see schedule-lock.ts). Should a deadlock or serialization
 * failure still happen, the attempt is retried (see withTransactionRetry).
 *
 * Business rules (opening hours, notice, horizon…) are validated by the
 * caller; this function only guarantees "no overlaps" and idempotency.
 */
export async function insertAppointment(db: Db, input: AppointmentInput): Promise<InsertResult> {
  // The id is generated here (not by the database) because the manage-link
  // token is derived from it and its hash must be part of the same INSERT.
  const id = randomUUID();
  const token = deriveManageToken(id);
  const { actor, ...values } = input;

  try {
    const appointment = await withTransactionRetry(() =>
      db.transaction(async (tx) => {
        await lockBarberSchedule(tx, values.barberId);

        const [created] = await tx
          .insert(appointments)
          .values({ ...values, id, manageTokenHash: hashToken(token), status: "confirmed" })
          .returning();
        if (!created) throw new Error("INSERT … RETURNING returned no row");

        await tx.insert(appointmentEvents).values({
          appointmentId: created.id,
          type: "created",
          actor,
          data: { startsAt: created.startsAt.toISOString(), barberId: created.barberId },
        });
        return created;
      }),
    );
    return { appointment, manageToken: token, replayed: false };
  } catch (error) {
    const overlaps = isConstraintViolation(
      error,
      PG_ERROR.exclusionViolation,
      NO_OVERLAP_CONSTRAINT,
    );
    const duplicateKey = isConstraintViolation(
      error,
      PG_ERROR.uniqueViolation,
      IDEMPOTENCY_CONSTRAINT,
    );

    // A retry of an already-successful request violates BOTH constraints, and
    // which one Postgres reports depends on index order. Check for a replay
    // first so the answer does not depend on that detail. The failed
    // transaction is already rolled back, so it is safe to query again.
    if (input.idempotencyKey && (overlaps || duplicateKey)) {
      const existing = await findAppointmentByIdempotencyKey(db, input.idempotencyKey);
      if (existing) {
        return {
          appointment: existing,
          manageToken: deriveManageToken(existing.id),
          replayed: true,
        };
      }
    }
    if (overlaps) throw new SlotUnavailableError();
    throw error;
  }
}

/** The appointment created by an earlier request with this idempotency key, if any. */
export async function findAppointmentByIdempotencyKey(
  db: Db,
  idempotencyKey: string,
): Promise<Appointment | undefined> {
  const [existing] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.idempotencyKey, idempotencyKey));
  return existing;
}

/**
 * "No preference" bookings: tries each candidate barber in order and keeps
 * the first one the database accepts. Candidates are expected to be sorted
 * by preference (e.g. least busy first) and pre-filtered by availability;
 * if another request wins the race for one of them we simply move on.
 */
export async function insertAppointmentWithAnyBarber(
  db: Db,
  candidateBarberIds: readonly string[],
  input: Omit<AppointmentInput, "barberId">,
): Promise<InsertResult> {
  for (const barberId of candidateBarberIds) {
    try {
      return await insertAppointment(db, { ...input, barberId });
    } catch (error) {
      if (error instanceof SlotUnavailableError) continue;
      throw error;
    }
  }
  throw new SlotUnavailableError();
}
