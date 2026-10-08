import { manageTokenSchema, type ManageAppointmentDto } from "@/lib/booking-schema";
import { NotFoundError } from "@/server/booking/errors";
import {
  findAppointmentByManageToken,
  type AppointmentDetails,
} from "@/server/booking/manage-appointment";
import { getDb } from "@/server/db/client";

/**
 * Resolves the appointment for a "manage your booking" API call.
 *
 * The secret travels in `Authorization: Bearer <token>`, never in the API
 * URL, so it does not end up in access logs or analytics. Malformed and
 * unknown tokens get the same 404, so the API never reveals which tokens
 * exist.
 */
export async function appointmentFromBearer(
  request: Request,
  now = new Date(),
): Promise<AppointmentDetails> {
  const header = request.headers.get("authorization") ?? "";
  const token = manageTokenSchema.safeParse(header.replace(/^Bearer\s+/i, ""));
  if (!token.success) throw new NotFoundError("Appointment not found");

  const details = await findAppointmentByManageToken(getDb(), token.data, now);
  if (!details) throw new NotFoundError("Appointment not found");
  return details;
}

export function toManageDto(details: AppointmentDetails): ManageAppointmentDto {
  return {
    id: details.id,
    status: details.status,
    startsAt: details.startsAt.toISOString(),
    endsAt: details.endsAt.toISOString(),
    barberName: details.barberName,
    serviceName: details.serviceName,
    durationMinutes: details.durationMinutes,
    priceCents: details.priceCents,
    customerName: details.customerName,
    canModify: details.canModify,
    modifiableUntil: details.modifiableUntil.toISOString(),
    calendarSequence: details.calendarSequence,
  };
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
