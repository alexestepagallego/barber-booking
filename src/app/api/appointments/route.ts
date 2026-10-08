import { after } from "next/server";
import { z } from "zod";

import {
  botCheckSchema,
  createBookingSchema,
  type BookingConfirmationDto,
} from "@/lib/booking-schema";
import { findAppointmentByIdempotencyKey } from "@/server/booking/appointments-repository";
import { createBooking } from "@/server/booking/create-booking";
import { getDb } from "@/server/db/client";
import { notifyBookingConfirmed } from "@/server/email/notifications";
import { getEmailTransport } from "@/server/email/transport";
import { apiError, handleApiError, rateLimited } from "@/server/http/api-response";
import { clientIp, RATE_LIMITS } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";

const idempotencyKeySchema = z.uuid().optional();

/**
 * POST /api/appointments
 *
 * Headers: `Idempotency-Key: <uuid>` (optional, recommended). Retrying with
 * the same key returns the original booking instead of creating a new one.
 *
 * 201 Created     → booking confirmed
 * 200 OK          → replay of an earlier request with the same key
 * 400 Bad Request → validation errors per field, or failed bot check
 * 404 Not Found   → unknown service or barber
 * 409 Conflict    → the time is no longer available
 * 429 Too Many    → rate limit (per IP, and per recipient email)
 * 503 Unavailable → the bot check service could not be reached
 *
 * Order of checks: cheap validation first, then rate limits, then the bot
 * check (an external call), and only then the database write.
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
    const bot = botCheckSchema.safeParse(json);
    // Honeypot filled in: a bot. Same answer as any failed bot check.
    if (!bot.success || bot.data.website) {
      return apiError(
        400,
        "bot_check_failed",
        "We could not verify this request. Please reload the page.",
      );
    }
    const input = createBookingSchema.parse(json);

    // Per IP (one client, many bookings) and per recipient address (stops
    // the form being used to flood someone's inbox with confirmations).
    const ip = clientIp(request.headers);
    const limited =
      (await rateLimited(RATE_LIMITS.bookingPerIp, ip)) ??
      (await rateLimited(RATE_LIMITS.bookingPerEmail, input.customerEmail));
    if (limited) return limited;

    const db = getDb();
    // Turnstile tokens are single-use. A retry of a request that already
    // succeeded (same Idempotency-Key) carries a spent token, so it is
    // answered with the original booking without re-verifying.
    const isReplay =
      idempotencyKey.data !== undefined &&
      (await findAppointmentByIdempotencyKey(db, idempotencyKey.data)) !== undefined;
    if (!isReplay) {
      const human = await verifyTurnstile(bot.data.turnstileToken, ip);
      if (!human.ok) {
        return human.reason === "unavailable"
          ? apiError(
              503,
              "bot_check_failed",
              "Verification is temporarily unavailable. Please try again.",
            )
          : apiError(400, "bot_check_failed", "Please complete the verification and try again.");
      }
    }

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
      emailConfigured: getEmailTransport().name !== "log",
    };
    return Response.json(body, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
