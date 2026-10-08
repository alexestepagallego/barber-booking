import { and, lt, ne } from "drizzle-orm";

import { retentionDays } from "@/server/config";
import type { Db } from "@/server/db/client";
import { appointments } from "@/server/db/schema";

const DAY = 24 * 60 * 60 * 1000;
export const ERASED_EMAIL = "erased@invalid.example";

/**
 * Data minimisation (GDPR art. 5): customer name, email and phone are only
 * needed to run an appointment. Once it is older than the retention period
 * they are overwritten. The appointment row itself stays, so statistics and
 * the agenda history keep working.
 */
export async function erasePersonalData(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays() * DAY);
  const erased = await db
    .update(appointments)
    .set({ customerName: "Erased", customerEmail: ERASED_EMAIL, customerPhone: "" })
    .where(and(lt(appointments.endsAt, cutoff), ne(appointments.customerEmail, ERASED_EMAIL)))
    .returning({ id: appointments.id });
  return { erased: erased.length, olderThan: cutoff.toISOString() };
}
