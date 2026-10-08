import { after } from "next/server";

import { cancelAppointment } from "@/server/booking/manage-appointment";
import { getDb } from "@/server/db/client";
import { notifyCancelled } from "@/server/email/notifications";
import { handleApiError } from "@/server/http/api-response";
import { appointmentFromBearer, NO_STORE, toManageDto } from "@/server/http/manage-auth";

/**
 * POST /api/manage/cancel
 * Authorization: Bearer <manage token>
 *
 * 200 → cancelled · 404 → unknown token · 409 not_modifiable → already
 * cancelled, started, or inside the cancellation cutoff.
 */
export async function POST(request: Request) {
  try {
    const appointment = await appointmentFromBearer(request);
    const db = getDb();
    const cancelled = await cancelAppointment(db, appointment.id, { actor: "customer" });
    after(() => notifyCancelled(db, appointment.id));
    return Response.json(toManageDto(cancelled), { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}
