import type { Metadata } from "next";
import { Suspense } from "react";

import { formatLongDate, formatTime, WEEKDAY_NAMES } from "@/lib/format";
import { loadAdminCatalogue } from "@/server/admin/catalogue-admin";
import { requireAdmin } from "@/server/admin/session";
import { localDate } from "@/server/booking/availability";
import { getDb } from "@/server/db/client";

import { addTimeOffAction, deleteTimeOffAction, saveScheduleAction } from "../../actions";
import { ActionForm, Input, Select, SubmitButton } from "../../ui";

export const metadata: Metadata = { title: "Hours & time off" };

export default function SchedulePage() {
  return (
    <div className="grid gap-10">
      <h1 className="font-display text-4xl italic">Hours &amp; time off</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ScheduleEditor />
      </Suspense>
    </div>
  );
}

async function ScheduleEditor() {
  await requireAdmin();
  const { settings, barbers, timeOff } = await loadAdminCatalogue(getDb());
  const tz = settings.timezone;
  const today = localDate(new Date(), tz);
  const nameOf = (id: string | null) =>
    id ? (barbers.find((b) => b.id === id)?.name ?? "Unknown") : "Whole shop";

  return (
    <>
      <section aria-labelledby="hours-heading" className="grid gap-4">
        <div>
          <h2 id="hours-heading" className="text-xs tracking-[0.2em] uppercase">
            Weekly hours
          </h2>
          <p className="text-muted mt-1 text-sm">
            Up to two shifts a day (e.g. morning and afternoon). Leave a day empty for a day off.
            Times are in {tz}.
          </p>
        </div>
        {barbers
          .filter((b) => b.active)
          .map((barber) => (
            <details key={barber.id} className="border-border bg-surface border p-5">
              <summary className="font-display cursor-pointer text-xl">{barber.name}</summary>
              <ActionForm action={saveScheduleAction} className="mt-5 grid gap-3">
                <input type="hidden" name="barberId" value={barber.id} />
                {WEEKDAY_NAMES.map((dayName, index) => {
                  const shifts = barber.hours.filter((h) => h.weekday === index + 1);
                  const [first, second] = shifts;
                  return (
                    <fieldset
                      key={dayName}
                      className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[120px_repeat(4,1fr)]"
                    >
                      <legend className="text-muted col-span-2 text-sm sm:col-span-1 sm:pt-6">
                        {dayName}
                      </legend>
                      <Input
                        label="From"
                        name={`day${index + 1}_start`}
                        type="time"
                        defaultValue={first?.startTime.slice(0, 5)}
                      />
                      <Input
                        label="To"
                        name={`day${index + 1}_end`}
                        type="time"
                        defaultValue={first?.endTime.slice(0, 5)}
                      />
                      <Input
                        label="From"
                        name={`day${index + 1}_start2`}
                        type="time"
                        defaultValue={second?.startTime.slice(0, 5)}
                      />
                      <Input
                        label="To"
                        name={`day${index + 1}_end2`}
                        type="time"
                        defaultValue={second?.endTime.slice(0, 5)}
                      />
                    </fieldset>
                  );
                })}
                <div>
                  <SubmitButton>Save {barber.name}&apos;s hours</SubmitButton>
                </div>
              </ActionForm>
            </details>
          ))}
      </section>

      <section aria-labelledby="timeoff-heading" className="grid gap-4">
        <div>
          <h2 id="timeoff-heading" className="text-xs tracking-[0.2em] uppercase">
            Time off and closures
          </h2>
          <p className="text-muted mt-1 text-sm">
            Blocks new bookings. Existing appointments in that period are kept and listed so you can
            contact the customers.
          </p>
        </div>

        {timeOff.length === 0 ? (
          <p className="text-muted text-sm">Nothing planned.</p>
        ) : (
          <ul className="grid gap-2">
            {timeOff.map((t) => (
              <li
                key={t.id}
                className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 border px-4 py-3 text-sm"
              >
                <span>
                  <strong>{nameOf(t.barberId)}</strong> · {formatLongDate(t.startsAt, tz)}{" "}
                  {formatTime(t.startsAt, tz)} → {formatLongDate(t.endsAt, tz)}{" "}
                  {formatTime(t.endsAt, tz)}
                  {t.reason ? <span className="text-muted"> · {t.reason}</span> : null}
                </span>
                <form action={deleteTimeOffAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className="text-muted text-xs underline hover:text-red-300">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <ActionForm
          action={addTimeOffAction}
          resetOnSuccess
          className="border-border grid gap-4 border p-5 sm:grid-cols-2"
        >
          <Select label="Who" name="barberId" defaultValue="" className="sm:col-span-2">
            <option value="">Whole shop (holiday, closure)</option>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Input
            label="From day"
            name="startDate"
            type="date"
            min={today}
            defaultValue={today}
            required
          />
          <Input
            label="To day"
            name="endDate"
            type="date"
            min={today}
            defaultValue={today}
            required
          />
          <Input
            label="From time (optional)"
            name="startTime"
            type="time"
            hint="Empty = whole days"
          />
          <Input label="To time (optional)" name="endTime" type="time" />
          <Input label="Reason (optional)" name="reason" className="sm:col-span-2" />
          <div className="sm:col-span-2">
            <SubmitButton>Add time off</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
