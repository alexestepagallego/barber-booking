import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import type { ApiErrorDto } from "@/lib/booking-schema";
import { NotFoundError, NotModifiableError, SlotUnavailableError } from "@/server/booking/errors";

export function apiError(
  status: number,
  code: ApiErrorDto["error"]["code"],
  message: string,
  fields?: Record<string, string>,
) {
  const body: ApiErrorDto = { error: { code, message, ...(fields && { fields }) } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Turns any error thrown by a handler into a JSON response. Known domain
 * errors get their own status; anything else is logged and hidden behind a
 * generic 500 so internals (SQL, stack traces) never reach the client.
 */
export function handleApiError(error: unknown): Response {
  // Next.js signals things like "this route is dynamic" by throwing internal
  // errors. Those belong to the framework, so they must never be swallowed.
  unstable_rethrow(error);

  if (error instanceof z.ZodError) {
    const fields = Object.fromEntries(
      error.issues.map((issue) => [issue.path.join(".") || "_", issue.message]),
    );
    return apiError(400, "validation_error", "Some fields are not valid", fields);
  }
  if (error instanceof NotFoundError) {
    return apiError(404, "not_found", error.message);
  }
  if (error instanceof SlotUnavailableError) {
    return apiError(
      409,
      "slot_unavailable",
      "Sorry, that time is no longer available. Please choose another one.",
    );
  }
  if (error instanceof NotModifiableError) {
    return apiError(409, "not_modifiable", error.message);
  }
  console.error("Unhandled API error", error);
  return apiError(500, "internal_error", "Something went wrong. Please try again.");
}
