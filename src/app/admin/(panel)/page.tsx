import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { addDays } from "@/lib/calendar";
import { formatCalendarDate, formatTime } from "@/lib/format";
import { loadAdminCatalogue, loadAgenda, loadTimeOffForDay } from "@/server/admin/catalogue-admin";
import { requireAdmin } from "@/server/admin/session";
import { dayBounds, isoWeekday, localDate } from "@/server/booking/availability";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = { title: "Agenda" };

const STATUS_STYLE = {
  confirmed: "border-foreground",
  completed: "border-emerald-400/50 text-emerald-200",
  no_show: "border-amber-400/50 text-amber-200",
  cancelled: "border-border text-muted line-through",
} as const;

const STATUS_LABEL = {
  confirmed: "Confirmed",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
} as const;

export default function AgendaPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading agenda…</p>}>
      <Agenda searchParams={searchParams} />
    </Suspense>
  );
}

async function Agenda({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  await requireAdmin();
  const db = getDb();
  const { settings, barbers } = await loadAdminCatalogue(db);
  const tz = settings.timezone;

  const requested = (await searchParams).date;
  const today = localDate(new Date(), tz);
  const date =
    typeof requested === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;

  const day = dayBounds(date, tz);
  const active = barbers.filter((b) => b.active);
  const [appointments, absences] = await Promise.all([
    loadAgenda(db, day),
    loadTimeOffForDay(
      db,
      day,
      active.map((b) => b.id),
    ),
  ]);
  const weekday = isoWeekday(date);
  const confirmedCount = appointments.filter((a) => a.status === "confirmed").length;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted text-xs tracking-[0.2em] uppercase">
            {date === today ? "Today" : "Agenda"}
          </p>
          <h1 className="font-display text-4xl italic">
            {formatCalendarDate(date, { weekday: "long", day: "numeric", month: "long" })}
          </h1>
          <p className="text-muted mt-1 text-sm">
            {confirmedCount} confirmed appointment{confirmedCount === 1 ? "" : "s"}
          </p>
        </div>
        <nav aria-label="Change day" className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            className="border-border hover:border-foreground border px-3 py-2"
            href={`/admin?date=${addDays(date, -1)}`}
          >
            ← Previous
          </Link>
          <Link className="border-border hover:border-foreground border px-3 py-2" href="/admin">
            Today
          </Link>
          <Link
            className="border-border hover:border-foreground border px-3 py-2"
            href={`/admin?date=${addDays(date, 1)}`}
          >
            Next →
          </Link>
          <form action="/admin" className="flex gap-2">
            <label className="sr-only" htmlFor="agenda-date">
              Go to date
            </label>
            <input
              id="agenda-date"
              type="date"
              name="date"
              defaultValue={date}
              className="border-border bg-surface border px-3 py-1.5 [color-scheme:dark]"
            />
            <button
              type="submit"
              className="border-border hover:border-foreground border px-3 py-2"
            >
              Go
            </button>
          </form>
        </nav>
      </div>

      {absences.some((t) => t.barberId === null) && (
        <p className="border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          The shop is closed for part or all of this day
          {absences.find((t) => t.barberId === null)?.reason
            ? `: ${absences.find((t) => t.barberId === null)?.reason}`
            : ""}
          .
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {active.map((barber) => {
          const own = appointments.filter((a) => a.barberId === barber.id);
          const shifts = barber.hours.filter((h) => h.weekday === weekday);
          const away = absences.filter((t) => t.barberId === barber.id);
          return (
            <section
              key={barber.id}
              aria-labelledby={`barber-${barber.id}`}
              className="grid content-start gap-3"
            >
              <div className="border-border flex items-baseline justify-between border-b pb-2">
                <h2 id={`barber-${barber.id}`} className="font-display text-2xl">
                  {barber.name}
                </h2>
                <p className="text-muted text-xs">
                  {shifts.length
                    ? shifts
                        .map((s) => `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`)
                        .join(" · ")
                    : "Day off"}
                </p>
              </div>
              {away.map((t) => (
                <p key={t.id} className="text-sm text-amber-200">
                  Away {formatTime(t.startsAt, tz)}–{formatTime(t.endsAt, tz)}
                  {t.reason ? ` · ${t.reason}` : ""}
                </p>
              ))}
              {own.length === 0 && <p className="text-muted text-sm">No appointments.</p>}
              <ol className="grid gap-2">
                {own.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/admin/appointments/${a.id}`}
                      className={`bg-surface hover:bg-background grid gap-1 border-l-2 px-4 py-3 transition-colors ${STATUS_STYLE[a.status]}`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="tabular-nums">
                          {formatTime(a.startsAt, tz)}–{formatTime(a.endsAt, tz)}
                        </span>
                        <span className="text-xs tracking-wider uppercase opacity-70">
                          {STATUS_LABEL[a.status]}
                        </span>
                      </span>
                      <span className="font-display text-lg">{a.customerName}</span>
                      <span className="text-muted text-sm">
                        {a.serviceName}
                        {a.customerPhone ? ` · ${a.customerPhone}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
