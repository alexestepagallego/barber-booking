import { z } from "zod";

import type { AvailabilityResponse } from "@/lib/booking-schema";
import { getAdmin } from "@/server/admin/session";
import { getAvailability } from "@/server/booking/get-availability";
import { getAppointmentDetails } from "@/server/booking/manage-appointment";
import { getDb } from "@/server/db/client";
import { handleApiError } from "@/server/http/api-response";

const querySchema = z.object({
  date: z.iso.date(),
  serviceId: z.uuid(),
  barberId: z.uuid(),
  exclude: z.uuid().optional(),
});

/**
 * GET /admin/api/availability — staff view of free times: no minimum notice
 * (walk-ins), a longer horizon, and optionally ignoring the appointment being
 * moved. Lives under /admin so the admin cookie (path=/admin) is sent.
 */
export async function GET(request: Request) {
  try {
    if (!(await getAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

    const db = getDb();
    const existing = query.exclude ? await getAppointmentDetails(db, query.exclude) : undefined;
    const slots = await getAvailability(db, {
      date: query.date,
      serviceId: query.serviceId,
      barberId: query.barberId,
      existingAppointment: existing && {
        id: existing.id,
        barberId: existing.barberId,
        durationMinutes: existing.durationMinutes,
      },
      policy: "staff",
    });
    const body: AvailabilityResponse = {
      date: query.date,
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        barberIds: s.barberIds,
      })),
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
