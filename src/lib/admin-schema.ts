import { z } from "zod";

/** Validation for admin forms. HTML forms send strings, so numbers are coerced explicitly. */

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal(""), z.undefined()])
  .transform((value) => value === "on" || value === "true");

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter your email")),
  password: z.string().min(1, "Enter your password").max(256),
});

export const serviceSchema = z.object({
  id: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(2, "Name is too short").max(80),
  description: z.string().trim().max(300).optional(),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(5, "At least 5 minutes")
    .max(480, "At most 8 hours")
    .refine((n) => n % 5 === 0, "Use multiples of 5 minutes"),
  price: z.coerce.number().min(0).max(10_000),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: checkbox,
});

export const barberSchema = z.object({
  id: z
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(2, "Name is too short").max(60),
  bio: z.string().trim().max(200).optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: checkbox,
  serviceIds: z.array(z.uuid()).default([]),
});

export const shiftSchema = z
  .object({ startTime: time, endTime: time })
  .refine((s) => s.endTime > s.startTime, "The shift must end after it starts");

export const weekScheduleSchema = z.object({
  barberId: z.uuid(),
  /** Shifts for weekdays 1 (Monday) to 7 (Sunday). */
  days: z
    .array(z.array(shiftSchema).max(4))
    .length(7)
    .refine(
      (days) =>
        days.every((shifts) =>
          [...shifts]
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .every((s, i, all) => i === 0 || all[i - 1]!.endTime <= s.startTime),
        ),
      "Shifts on the same day cannot overlap",
    ),
});

export const timeOffSchema = z
  .object({
    /** Empty means the whole shop is closed. */
    barberId: z
      .uuid()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    startTime: time.optional().or(z.literal("").transform(() => undefined)),
    endTime: time.optional().or(z.literal("").transform(() => undefined)),
    reason: z.string().trim().max(120).optional(),
  })
  .refine((t) => t.endDate >= t.startDate, {
    message: "End date is before start",
    path: ["endDate"],
  });

export const shopSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(160).optional(),
  slotIntervalMinutes: z.coerce
    .number()
    .int()
    .refine((n) => [5, 10, 15, 20, 30, 60].includes(n), {
      message: "Choose 5, 10, 15, 20, 30 or 60",
    }),
  bookingHorizonDays: z.coerce.number().int().min(1).max(365),
  minNoticeMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60),
  cancellationCutoffMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60),
});

/** Walk-ins and phone bookings: email is optional (no email is then sent). */
export const staffBookingSchema = z.object({
  serviceId: z.uuid(),
  barberId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  customerName: z
    .string()
    .trim()
    .min(2, "Enter the customer's name")
    .max(80)
    .regex(/^[\p{L}\p{M}][\p{L}\p{M}'’ .-]*$/u, "Use letters only"),
  customerPhone: z
    .string()
    .transform((v) => v.replace(/[\s()-]/g, ""))
    .pipe(z.string().regex(/^(\+?\d{9,15})?$/, "Enter a valid phone number")),
  customerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.union([z.literal(""), z.email("Enter a valid email or leave it empty")])),
});

export const staffRescheduleSchema = z.object({
  appointmentId: z.uuid(),
  barberId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

/** Zod issues → { field: firstMessage } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    errors[key] ??= issue.message;
  }
  return errors;
}
