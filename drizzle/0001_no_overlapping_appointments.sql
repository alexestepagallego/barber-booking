-- The core invariant of the system: a barber can never have two confirmed
-- appointments whose time ranges overlap.
--
-- An exclusion constraint is like a UNIQUE constraint generalised to any
-- operator: Postgres rejects a row if another row exists where every listed
-- operator returns true. Here that means "same barber" (=) AND "time ranges
-- overlap" (&&). The check and the write happen atomically inside the
-- database, so it holds under any level of concurrency, from any number of
-- app instances. See docs/concurrency.md.
--
-- btree_gist lets a GiST index handle plain equality on uuid alongside the
-- range overlap operator.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Half-open ranges '[)': an appointment ending at 10:30 does NOT overlap
-- one starting at 10:30, so back-to-back bookings are allowed.
-- Only confirmed appointments block time; cancelled ones free their slot,
-- and completed/no_show ones are in the past.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "barber_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" = 'confirmed');
