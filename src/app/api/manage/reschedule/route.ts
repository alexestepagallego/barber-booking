import { after } from "next/server";

import { rescheduleSchema } from "@/lib/booking-schema";
import { rescheduleAppointment } from "@/server/booking/manage-appointment";
import { getDb } from "@/server/db/client";
import { notifyRescheduled } from "@/server/email/notifications";
import { apiError, handleApiError, rateLimited } from "@/server/http/api-response";
import { appointmentFromBearer, NO_STORE, toManageDto } from "@/server/http/manage-auth";
import { clientIp, RATE_LIMITS } from "@/server/security/rate-limit";

/**
 * POST /api/manage/reschedule   { "startsAt": "2026-10-08T17:00:00+02:00" }
 * Authorization: Bearer <manage token>
 *
 * 200 → moved · 404 → unknown token · 409 slot_unavailable → time taken or
 * not offered · 409 not_modifiable → cancelled, started or too late.
 */
export async function POST(request: Request) {
  try {
    const limited = await rateLimited(RATE_LIMITS.manageWritePerIp, clientIp(request.headers));
    if (limited) return limited;

    const appointment = await appointmentFromBearer(request);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return apiError(400, "validation_error", "Request body must be valid JSON");
    }
    const { startsAt } = rescheduleSchema.parse(json);

    const db = getDb();
    const { before, after: moved } = await rescheduleAppointment(db, appointment.id, {
      startsAt,
      actor: "customer",
    });
    if (moved.startsAt.getTime() !== before.startsAt.getTime()) {
      after(() => notifyRescheduled(db, appointment.id, before.startsAt));
    }
    return Response.json(toManageDto(moved), { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}
