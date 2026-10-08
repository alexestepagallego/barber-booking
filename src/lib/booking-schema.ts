import { z } from "zod";

/**
 * Request schemas shared by the booking form (instant feedback) and the API
 * (the actual enforcement). The server never trusts that the client ran them.
 */

export const availabilityQuerySchema = z.object({
  date: z.iso.date(),
  serviceId: z.uuid(),
  barberId: z.uuid().optional(),
});

export const customerDetailsSchema = z.object({
  customerName: z.string().trim().min(2, "Please enter your name").max(80, "Name is too long"),
  // Trim before validating: mobile autocomplete often appends a space.
  customerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Email is too long")
    .pipe(z.email("Please enter a valid email address")),
  customerPhone: z
    .string()
    .transform((value) => value.replace(/[\s()-]/g, ""))
    .pipe(z.string().regex(/^\+?\d{9,15}$/, "Please enter a valid phone number")),
  privacyAccepted: z.literal(true, "You need to accept the privacy policy"),
});

export const createBookingSchema = customerDetailsSchema.extend({
  serviceId: z.uuid(),
  /** null means "no preference". */
  barberId: z.uuid().nullable(),
  startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});

export type CustomerDetailsInput = z.input<typeof customerDetailsSchema>;
export type CreateBookingInput = z.output<typeof createBookingSchema>;
export type CreateBookingRequest = z.input<typeof createBookingSchema>;

/** JSON shapes returned by the API, shared with the client. */
export type SlotDto = { startsAt: string; endsAt: string; barberIds: string[] };

export type AvailabilityResponse = { date: string; slots: SlotDto[] };

export type BookingConfirmationDto = {
  id: string;
  startsAt: string;
  endsAt: string;
  barberName: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  /** Path of the manage-your-booking page (contains the secret token). */
  managePath: string;
};

export type ApiErrorDto = {
  error: {
    code:
      | "validation_error"
      | "not_found"
      | "slot_unavailable"
      | "not_modifiable"
      | "rate_limited"
      | "bot_check_failed"
      | "internal_error";
    message: string;
    fields?: Record<string, string>;
  };
};

/** Manage links carry 32 random bytes encoded as base64url: exactly 43 characters. */
export const manageTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const rescheduleSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});

export type ManageAppointmentDto = {
  id: string;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
  startsAt: string;
  endsAt: string;
  barberName: string;
  serviceName: string;
  durationMinutes: number;
  priceCents: number;
  customerName: string;
  canModify: boolean;
  modifiableUntil: string;
};
