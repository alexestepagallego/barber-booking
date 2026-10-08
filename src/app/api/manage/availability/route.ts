import { z } from "zod";

import type { AvailabilityResponse } from "@/lib/booking-schema";
import { getAvailability } from "@/server/booking/get-availability";
import { getDb } from "@/server/db/client";
import { handleApiError } from "@/server/http/api-response";
import { appointmentFromBearer, NO_STORE } from "@/server/http/manage-auth";

const querySchema = z.object({ date: z.iso.date() });

/**
 * GET /api/manage/availability?date=YYYY-MM-DD
 * Authorization: Bearer <manage token>
 *
 * Times this appointment can be moved to: same barber, same service, and
 * its own current time does not count as busy.
 */
export async function GET(request: Request) {
  try {
    const { date } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const appointment = await appointmentFromBearer(request);

    const slots = await getAvailability(getDb(), {
      date,
      serviceId: appointment.serviceId,
      barberId: appointment.barberId,
      excludeAppointmentId: appointment.id,
    });

    const body: AvailabilityResponse = {
      date,
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        barberIds: s.barberIds,
      })),
    };
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error);
  }
}
