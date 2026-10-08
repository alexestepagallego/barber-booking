import type { AvailabilityResponse } from "@/lib/booking-schema";
import { availabilityQuerySchema } from "@/lib/booking-schema";
import { getAvailability } from "@/server/booking/get-availability";
import { getDb } from "@/server/db/client";
import { handleApiError, rateLimited } from "@/server/http/api-response";
import { clientIp, RATE_LIMITS } from "@/server/security/rate-limit";

/**
 * GET /api/availability?date=YYYY-MM-DD&serviceId=…[&barberId=…]
 *
 * Bookable start times for one day. Never cached: availability changes with
 * every booking, and a stale answer would only produce more 409s.
 */
export async function GET(request: Request) {
  try {
    const limited = await rateLimited(RATE_LIMITS.availabilityPerIp, clientIp(request.headers));
    if (limited) return limited;

    const params = Object.fromEntries(new URL(request.url).searchParams);
    const query = availabilityQuerySchema.parse(params);

    const slots = await getAvailability(getDb(), query);

    const body: AvailabilityResponse = {
      date: query.date,
      slots: slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        barberIds: slot.barberIds,
      })),
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
