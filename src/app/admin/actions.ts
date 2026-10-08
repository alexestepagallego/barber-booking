"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import {
  barberSchema,
  fieldErrors,
  loginSchema,
  serviceSchema,
  shopSettingsSchema,
  shiftSchema,
  staffBookingSchema,
  staffRescheduleSchema,
  timeOffSchema,
  weekScheduleSchema,
} from "@/lib/admin-schema";
import { verifyCredentials } from "@/server/admin/auth";
import {
  addTimeOff,
  deleteTimeOff,
  saveBarber,
  saveService,
  saveShopSettings,
  saveWeekSchedule,
} from "@/server/admin/catalogue-admin";
import { requestHeaders, requireAdmin, startSession } from "@/server/admin/session";
import { createBooking } from "@/server/booking/create-booking";
import { NotFoundError, NotModifiableError, SlotUnavailableError } from "@/server/booking/errors";
import {
  cancelAppointment,
  markAppointmentOutcome,
  rescheduleAppointment,
} from "@/server/booking/manage-appointment";
import { CATALOGUE_TAG } from "@/server/catalogue";
import { getDb } from "@/server/db/client";
import { shopSettings } from "@/server/db/schema";
import {
  notifyBookingConfirmed,
  notifyCancelled,
  notifyRescheduled,
} from "@/server/email/notifications";
import { checkRateLimit, clientIp, RATE_LIMITS } from "@/server/security/rate-limit";

/**
 * Admin Server Actions. Each one is a public POST endpoint, so each one:
 * 1. checks the session itself (requireAdmin), whatever page rendered it,
 * 2. validates its input with Zod,
 * 3. mutates through the same domain functions as the public API,
 * 4. invalidates the cached catalogue with updateTag when it changed it,
 * 5. redirects last, outside any try/catch.
 */

export type ActionState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
};

const formObject = (formData: FormData) =>
  Object.fromEntries([...formData.entries()].filter(([key]) => !key.startsWith("$ACTION")));

function domainError(error: unknown): ActionState {
  if (
    error instanceof SlotUnavailableError ||
    error instanceof NotModifiableError ||
    error instanceof NotFoundError ||
    error instanceof RangeError
  ) {
    return { ok: false, message: error.message };
  }
  throw error;
}

// ─── Authentication ──────────────────────────────────────────────────────────

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  // Both limits apply: per IP (one attacker, many accounts) and per account
  // (many IPs, one account). The response is identical either way.
  const db = getDb();
  const ip = clientIp(await requestHeaders());
  const [byIp, byAccount] = await Promise.all([
    checkRateLimit(db, RATE_LIMITS.loginPerIp, ip),
    checkRateLimit(db, RATE_LIMITS.loginPerAccount, parsed.data.email),
  ]);
  if (!byIp.allowed || !byAccount.allowed) {
    const minutes = Math.ceil(Math.max(byIp.retryAfter, byAccount.retryAfter) / 60);
    return { ok: false, message: `Too many attempts. Try again in ${minutes} min.` };
  }

  const admin = await verifyCredentials(db, parsed.data.email, parsed.data.password);
  if (!admin) return { ok: false, message: "Email or password is incorrect." };

  await startSession(admin.id);
  redirect("/admin");
}

// ─── Appointments ────────────────────────────────────────────────────────────

export async function staffBook(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = staffBookingSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const db = getDb();
  let appointmentId: string;
  try {
    const result = await createBooking(db, parsed.data, { actor: "admin" });
    appointmentId = result.appointment.id;
  } catch (error) {
    return domainError(error);
  }
  if (parsed.data.customerEmail) after(() => notifyBookingConfirmed(db, appointmentId));
  redirect(`/admin/appointments/${appointmentId}?created=1`);
}

const idSchema = z.object({ appointmentId: z.uuid() });

export async function staffCancel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = idSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, message: "Invalid appointment" };

  const db = getDb();
  try {
    await cancelAppointment(db, parsed.data.appointmentId, { actor: "admin" });
  } catch (error) {
    return domainError(error);
  }
  after(() => notifyCancelled(db, parsed.data.appointmentId));
  // Redirect rather than return a message: the actions block disappears once
  // the appointment is no longer confirmed, so the page shows the outcome.
  redirect(`/admin/appointments/${parsed.data.appointmentId}?updated=cancelled`);
}

export async function staffOutcome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = idSchema
    .extend({ outcome: z.enum(["completed", "no_show"]) })
    .safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, message: "Invalid request" };

  try {
    await markAppointmentOutcome(getDb(), parsed.data.appointmentId, {
      outcome: parsed.data.outcome,
    });
  } catch (error) {
    return domainError(error);
  }
  redirect(`/admin/appointments/${parsed.data.appointmentId}?updated=${parsed.data.outcome}`);
}

export async function staffReschedule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = staffRescheduleSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const db = getDb();
  let before: Date;
  let moved: boolean;
  try {
    const result = await rescheduleAppointment(db, parsed.data.appointmentId, {
      startsAt: parsed.data.startsAt,
      barberId: parsed.data.barberId,
      actor: "admin",
    });
    before = result.before.startsAt;
    moved =
      result.before.startsAt.getTime() !== result.after.startsAt.getTime() ||
      result.before.barberId !== result.after.barberId;
  } catch (error) {
    return domainError(error);
  }
  if (!moved) return { ok: true, message: "Nothing changed: that is already its time and barber." };
  after(() => notifyRescheduled(db, parsed.data.appointmentId, before));
  redirect(`/admin/appointments/${parsed.data.appointmentId}?updated=moved`);
}

// ─── Catalogue ───────────────────────────────────────────────────────────────

export async function saveServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = serviceSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  await saveService(getDb(), parsed.data);
  updateTag(CATALOGUE_TAG);
  return { ok: true, message: `Saved "${parsed.data.name}".` };
}

export async function saveBarberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = barberSchema.safeParse({
    ...formObject(formData),
    serviceIds: formData.getAll("serviceIds"),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  await saveBarber(getDb(), parsed.data);
  updateTag(CATALOGUE_TAG);
  return { ok: true, message: `Saved "${parsed.data.name}".` };
}

export async function saveScheduleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  // Fields are named day1_start, day1_end, … day7_start2, day7_end2 (two shifts a day).
  const days = [1, 2, 3, 4, 5, 6, 7].map((day) =>
    ["", "2"].flatMap((suffix) => {
      const startTime = String(formData.get(`day${day}_start${suffix}`) ?? "");
      const endTime = String(formData.get(`day${day}_end${suffix}`) ?? "");
      return startTime || endTime ? [{ startTime, endTime }] : [];
    }),
  );
  const invalidShift = days.flat().find((s) => !shiftSchema.safeParse(s).success);
  if (invalidShift) {
    return {
      ok: false,
      message: `Check ${invalidShift.startTime || "?"}–${invalidShift.endTime || "?"}: shifts need a start and a later end time.`,
    };
  }
  const parsed = weekScheduleSchema.safeParse({ barberId: formData.get("barberId"), days });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };

  await saveWeekSchedule(getDb(), parsed.data);
  updateTag(CATALOGUE_TAG);
  return { ok: true, message: "Schedule saved." };
}

export async function addTimeOffAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = timeOffSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const db = getDb();
  const [settings] = await db.select().from(shopSettings);
  let conflicts: Awaited<ReturnType<typeof addTimeOff>>;
  try {
    conflicts = await addTimeOff(db, parsed.data, settings!.timezone);
  } catch (error) {
    return domainError(error);
  }
  updateTag(CATALOGUE_TAG);
  return {
    ok: true,
    message: conflicts.length
      ? `Saved. ${conflicts.length} existing appointment(s) fall in this period and were kept: contact those customers (${conflicts.map((c) => c.customerName).join(", ")}).`
      : "Saved.",
  };
}

export async function deleteTimeOffAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  await deleteTimeOff(getDb(), id.data);
  updateTag(CATALOGUE_TAG);
}

export async function saveSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = shopSettingsSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  await saveShopSettings(getDb(), parsed.data);
  updateTag(CATALOGUE_TAG);
  return { ok: true, message: "Settings saved." };
}
