import { after } from "next/server";
import { z } from "zod";

import { createBookingSchema, type BookingConfirmationDto } from "@/lib/booking-schema";
import { createBooking } from "@/server/booking/create-booking";
import { getDb } from "@/server/db/client";
import { notifyBookingConfirmed } from "@/server/email/notifications";
import { apiError, handleApiError, rateLimited } from "@/server/http/api-response";
import { clientIp, RATE_LIMITS } from "@/server/security/rate-limit";

const idempotencyKeySchema = z.uuid().optional();

/**
 * POST /api/appointments
 *
 * Headers: `Idempotency-Key: <uuid>` (optional, recommended). Retrying with
 * the same key returns the original booking instead of creating a new one.
 *
 * 201 Created     → booking confirmed
 * 200 OK          → replay of an earlier request with the same key
 * 400 Bad Request → validation errors per field
 * 404 Not Found   → unknown service or barber
 * 409 Conflict    → the time is no longer available
 */
export async function POST(request: Request) {
  try {
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key") ?? undefined,
    );
    if (!idempotencyKey.success) {
      return apiError(400, "validation_error", "Idempotency-Key must be a UUID");
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return apiError(400, "validation_error", "Request body must be valid JSON");
    }
    const input = createBookingSchema.parse(json);

    // Per IP (one client, many bookings) and per recipient address (stops
    // the form being used to flood someone's inbox with confirmations).
    const limited =
      (await rateLimited(RATE_LIMITS.bookingPerIp, clientIp(request.headers))) ??
      (await rateLimited(RATE_LIMITS.bookingPerEmail, input.customerEmail));
    if (limited) return limited;

    const db = getDb();
    const result = await createBooking(db, input, { idempotencyKey: idempotencyKey.data });
    // The email goes out after the response is sent, and only once per booking.
    if (!result.replayed) after(() => notifyBookingConfirmed(db, result.appointment.id));

    const body: BookingConfirmationDto = {
      id: result.appointment.id,
      startsAt: result.appointment.startsAt.toISOString(),
      endsAt: result.appointment.endsAt.toISOString(),
      barberName: result.barberName,
      serviceName: result.serviceName,
      customerName: result.appointment.customerName,
      customerEmail: result.appointment.customerEmail,
      managePath: `/manage/${result.manageToken}`,
    };
    return Response.json(body, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
