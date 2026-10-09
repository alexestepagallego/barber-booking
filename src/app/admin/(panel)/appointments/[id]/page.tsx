import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { formatDuration, formatLongDate, formatPrice, formatTime } from "@/lib/format";
import { loadAdminCatalogue } from "@/server/admin/catalogue-admin";
import { requireAdminPage } from "@/server/admin/session";
import { localDate } from "@/server/booking/availability";
import { getAppointmentDetails } from "@/server/booking/manage-appointment";
import { appUrl } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getEmailTransport } from "@/server/email/transport";
import { appointmentEvents } from "@/server/db/schema";
import { deriveManageToken } from "@/server/security/tokens";

import { AppointmentActions } from "./appointment-actions";

export const metadata: Metadata = { title: "Appointment" };

const UPDATED_MESSAGE = {
  cancelled: "Appointment cancelled.",
  moved: "Appointment moved.",
  completed: "Marked as completed.",
  no_show: "Marked as a no-show.",
} as const;

const EVENT_LABEL = {
  created: "Booked",
  rescheduled: "Moved",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
  reminder_sent: "Reminder sent",
} as const;

export default function AppointmentPage({
  params,
  searchParams,
}: PageProps<"/admin/appointments/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({
  params,
  searchParams,
}: Pick<PageProps<"/admin/appointments/[id]">, "params" | "searchParams">) {
  await requireAdminPage();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = getDb();
  const now = new Date();
  const details = await getAppointmentDetails(db, id, now);
  if (!details) notFound();

  const [{ barbers }, events, { created, updated }] = await Promise.all([
    loadAdminCatalogue(db),
    db
      .select()
      .from(appointmentEvents)
      .where(eq(appointmentEvents.appointmentId, id))
      .orderBy(asc(appointmentEvents.createdAt)),
    searchParams,
  ]);
  const tz = details.timezone;
  // Only claim an email when one can actually be sent.
  const emailsSent = Boolean(details.customerEmail) && getEmailTransport().name !== "log";
  const date = localDate(details.startsAt, tz);
  const manageUrl = `${appUrl()}/manage/${deriveManageToken(details.id)}`;

  return (
    <div className="grid max-w-3xl gap-8">
      <Link href={`/admin?date=${date}`} className="text-muted hover:text-foreground text-sm">
        ← Back to {formatLongDate(details.startsAt, tz)}
      </Link>

      {typeof updated === "string" && updated in UPDATED_MESSAGE && (
        <p
          role="status"
          className="border border-emerald-400/50 px-4 py-3 text-sm text-emerald-200"
        >
          {UPDATED_MESSAGE[updated as keyof typeof UPDATED_MESSAGE]}
          {emailsSent && (updated === "cancelled" || updated === "moved")
            ? " An email is on its way to the customer."
            : ""}
        </p>
      )}

      {created && (
        <p
          role="status"
          className="border border-emerald-400/50 px-4 py-3 text-sm text-emerald-200"
        >
          Booked.{emailsSent ? " A confirmation email is on its way to the customer." : ""}
        </p>
      )}

      <section className="border-border bg-surface grid gap-4 border p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl">{details.customerName}</h1>
          <span className="border-border border px-3 py-1 text-xs tracking-[0.2em] uppercase">
            {details.status.replace("_", "-")}
          </span>
        </div>
        <dl className="text-muted grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm [&_dd]:break-words">
          <dt>When</dt>
          <dd className="text-foreground">
            {formatLongDate(details.startsAt, tz)}, {formatTime(details.startsAt, tz)}–
            {formatTime(details.endsAt, tz)}
          </dd>
          <dt>Service</dt>
          <dd className="text-foreground">
            {details.serviceName} · {formatDuration(details.durationMinutes)} ·{" "}
            {formatPrice(details.priceCents)}
          </dd>
          <dt>Barber</dt>
          <dd className="text-foreground">{details.barberName}</dd>
          <dt>Phone</dt>
          <dd className="text-foreground">
            {details.customerPhone ? (
              <a className="underline" href={`tel:${details.customerPhone}`}>
                {details.customerPhone}
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt>Email</dt>
          <dd className="text-foreground">
            {details.customerEmail ? (
              <a className="underline" href={`mailto:${details.customerEmail}`}>
                {details.customerEmail}
              </a>
            ) : (
              "—"
            )}
          </dd>
          {details.status === "confirmed" && (
            <>
              <dt>Customer link</dt>
              <dd className="text-foreground break-all">
                <span className="text-muted text-xs">
                  Share it (e.g. by message) so the customer can change or cancel online:
                </span>
                <br />
                <code className="text-xs">{manageUrl}</code>
              </dd>
            </>
          )}
        </dl>
      </section>

      <AppointmentActions
        appointmentId={details.id}
        serviceId={details.serviceId}
        status={details.status}
        started={details.startsAt <= now}
        barberId={details.barberId}
        barbers={barbers
          .filter((b) => b.active && b.serviceIds.includes(details.serviceId))
          .map((b) => ({ id: b.id, name: b.name }))}
        timezone={tz}
        today={localDate(now, tz)}
      />

      <section aria-labelledby="history-heading" className="grid gap-3">
        <h2 id="history-heading" className="text-xs tracking-[0.2em] uppercase">
          History
        </h2>
        <ol className="border-border grid gap-2 border-l pl-4 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              <span className="text-foreground">{EVENT_LABEL[event.type]}</span>
              <span className="text-muted">
                {" "}
                by {event.actor} · {formatLongDate(event.createdAt, tz)}{" "}
                {formatTime(event.createdAt, tz)}
                {event.type === "rescheduled" && event.data?.from
                  ? ` · from ${formatTime(String(event.data.from), tz)} on ${formatLongDate(String(event.data.from), tz)}`
                  : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
