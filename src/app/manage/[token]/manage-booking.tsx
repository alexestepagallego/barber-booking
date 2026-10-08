"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  DayPicker,
  errorOf,
  primaryButton,
  secondaryButton,
  Step,
  TimePicker,
  useAvailability,
  useHydrated,
} from "@/components/booking-ui";
import type { ManageAppointmentDto, SlotDto } from "@/lib/booking-schema";
import { formatDuration, formatLongDate, formatPrice, formatTime } from "@/lib/format";
import { buildIcs } from "@/lib/ics";
import type { Catalogue } from "@/server/catalogue";

type Mode = "view" | "reschedule" | "confirm-cancel";

const STATUS_LABEL: Record<ManageAppointmentDto["status"], string> = {
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "Missed",
};

const linkButton =
  "text-muted hover:text-foreground text-xs tracking-[0.2em] uppercase underline-offset-4 hover:underline disabled:opacity-50";

export function ManageBooking({
  token,
  initial,
  shop,
  today,
  closedWeekdays,
}: {
  token: string;
  initial: ManageAppointmentDto;
  shop: Catalogue["shop"];
  today: string;
  closedWeekdays: number[];
}) {
  const hydrated = useHydrated();
  const [appointment, setAppointment] = useState(initial);
  const [mode, setMode] = useState<Mode>("view");
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Focus management: opening a section moves focus to its heading, and
  // closing it returns focus to the button that opened it, so keyboard and
  // screen-reader users never end up on <body>.
  const statusRef = useRef<HTMLParagraphElement>(null);
  const cancelHeadingRef = useRef<HTMLHeadingElement>(null);
  const rescheduleHeadingRef = useRef<HTMLHeadingElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<"change" | "cancel" | "status" | null>(null);

  useEffect(() => {
    if (mode === "confirm-cancel") cancelHeadingRef.current?.focus();
    else if (mode === "reschedule") rescheduleHeadingRef.current?.focus();
    else if (returnFocusTo.current === "status") statusRef.current?.focus();
    else if (returnFocusTo.current === "change") changeButtonRef.current?.focus();
    else if (returnFocusTo.current === "cancel") cancelButtonRef.current?.focus();
  }, [mode]);

  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const closed = useMemo(() => new Set(closedWeekdays), [closedWeekdays]);
  const { state: availability, reload } = useAvailability(
    mode === "reschedule" && date
      ? `/api/manage/availability?${new URLSearchParams({ date })}`
      : null,
    auth,
  );

  const tz = shop.timezone;
  const active = appointment.status === "confirmed";

  function open(next: Mode, from: "change" | "cancel") {
    setMessage(null);
    returnFocusTo.current = from;
    setMode(next);
  }

  function close() {
    setMode("view");
  }

  function announce(text: string) {
    setMessage(text);
    returnFocusTo.current = "status";
    setMode("view");
    // Also when the mode was already "view".
    requestAnimationFrame(() => statusRef.current?.focus());
  }

  async function call(path: string, body?: unknown) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { ...auth, ...(body !== undefined && { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.ok) {
        setAppointment((await response.json()) as ManageAppointmentDto);
        return { ok: true as const };
      }
      return { ok: false as const, error: await errorOf(response) };
    } catch {
      return {
        ok: false as const,
        error: {
          code: "internal_error" as const,
          message: "Connection problem. Please try again.",
        },
      };
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const result = await call("/api/manage/cancel");
    if (result.ok) return announce("Your appointment has been cancelled.");
    if (result.error.code === "not_modifiable") setAppointment((a) => ({ ...a, canModify: false }));
    announce(result.error.message);
  }

  async function reschedule() {
    if (!slot) return;
    if (slot.startsAt === appointment.startsAt) {
      setNotice("That is already your appointment time. Choose a different one.");
      return;
    }
    const result = await call("/api/manage/reschedule", { startsAt: slot.startsAt });
    if (result.ok) {
      setSlot(null);
      setDate(null);
      return announce("Done! Your appointment has been moved.");
    }
    if (result.error.code === "slot_unavailable") {
      setSlot(null);
      setNotice(result.error.message);
      await reload();
      return;
    }
    if (result.error.code === "not_modifiable") setAppointment((a) => ({ ...a, canModify: false }));
    announce(result.error.message);
  }

  function downloadCalendarInvite() {
    const ics = buildIcs({
      uid: `${appointment.id}@barber-booking`,
      // The same SEQUENCE as the emailed invites, so later updates and
      // cancellations sent by email still replace this copy.
      sequence: appointment.calendarSequence,
      startsAt: new Date(appointment.startsAt),
      endsAt: new Date(appointment.endsAt),
      summary: `${appointment.serviceName} · ${shop.name}`,
      description: `With ${appointment.barberName}.\n${window.location.href}`,
      location: shop.address ?? shop.name,
      status: "confirmed",
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: "chane-barber-appointment.ics",
    });
    link.click();
    // Give the browser time to start the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="grid gap-10">
      <section
        aria-labelledby="appointment-heading"
        className="border-border bg-surface grid gap-4 border p-6 sm:p-8"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="appointment-heading" className="font-display text-3xl">
            {appointment.serviceName}
          </h2>
          <span
            className={`border px-3 py-1 text-xs tracking-[0.2em] uppercase ${
              active ? "border-foreground" : "border-border text-muted"
            }`}
          >
            {STATUS_LABEL[appointment.status]}
          </span>
        </div>
        <dl className="text-muted grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt>When</dt>
          <dd className={`text-foreground ${active ? "" : "line-through"}`}>
            {formatLongDate(appointment.startsAt, tz)}, {formatTime(appointment.startsAt, tz)}–
            {formatTime(appointment.endsAt, tz)}
          </dd>
          <dt>Barber</dt>
          <dd className="text-foreground">{appointment.barberName}</dd>
          <dt>Price</dt>
          <dd className="text-foreground">
            {formatPrice(appointment.priceCents)} · {formatDuration(appointment.durationMinutes)}
          </dd>
          <dt>Name</dt>
          <dd className="text-foreground">{appointment.customerName}</dd>
        </dl>

        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          className="text-sm outline-none empty:hidden"
        >
          {message}
        </p>

        {active && mode === "view" && (
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {appointment.canModify && (
              <>
                <button
                  ref={changeButtonRef}
                  type="button"
                  className={secondaryButton}
                  disabled={!hydrated}
                  onClick={() => open("reschedule", "change")}
                >
                  Change time
                </button>
                <button
                  ref={cancelButtonRef}
                  type="button"
                  className={secondaryButton}
                  disabled={!hydrated}
                  onClick={() => open("confirm-cancel", "cancel")}
                >
                  Cancel appointment
                </button>
              </>
            )}
            <button
              type="button"
              className={linkButton}
              disabled={!hydrated}
              onClick={downloadCalendarInvite}
            >
              Add to calendar
            </button>
          </div>
        )}

        {/* A confirmed appointment that can't be modified is past its cutoff. */}
        {active && !appointment.canModify && (
          <p className="text-muted text-sm">
            Online changes closed at {formatTime(appointment.modifiableUntil, tz)} on{" "}
            {formatLongDate(appointment.modifiableUntil, tz)}.
            {shop.phone && (
              <>
                {" "}
                To change or cancel it now, please call us on{" "}
                <a
                  href={`tel:${shop.phone.replace(/\s/g, "")}`}
                  className="text-foreground underline"
                >
                  {shop.phone}
                </a>
                .
              </>
            )}
          </p>
        )}

        {appointment.status === "cancelled" && (
          <a href="/book" className={`${secondaryButton} justify-self-start`}>
            Book another time
          </a>
        )}
      </section>

      {mode === "confirm-cancel" && (
        <section
          aria-labelledby="cancel-heading"
          className="grid gap-4 border border-red-400/40 p-6"
        >
          <h2
            id="cancel-heading"
            ref={cancelHeadingRef}
            tabIndex={-1}
            className="font-display text-2xl outline-none"
          >
            Cancel this appointment?
          </h2>
          <p className="text-muted text-sm">The time will be released for other customers.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primaryButton} disabled={busy} onClick={cancel}>
              {busy ? "Cancelling…" : "Yes, cancel it"}
            </button>
            <button type="button" className={secondaryButton} onClick={close}>
              Keep it
            </button>
          </div>
        </section>
      )}

      {mode === "reschedule" && (
        <section aria-labelledby="reschedule-heading" className="grid gap-10">
          <h2
            id="reschedule-heading"
            ref={rescheduleHeadingRef}
            tabIndex={-1}
            className="font-display text-2xl outline-none"
          >
            Choose a new time
          </h2>
          <Step title="New day">
            <DayPicker
              today={today}
              horizonDays={shop.bookingHorizonDays}
              closedWeekdays={closed}
              value={date}
              onChange={(next) => {
                setDate(next);
                setSlot(null);
                setNotice(null);
              }}
            />
          </Step>
          <Step title="New time" disabled={!date}>
            <TimePicker
              availability={availability}
              timezone={tz}
              value={slot?.startsAt ?? null}
              onChange={(next) => {
                setSlot(next);
                setNotice(null);
              }}
              notice={notice}
            />
          </Step>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={primaryButton}
              disabled={!slot || busy}
              onClick={reschedule}
            >
              {busy
                ? "Moving…"
                : slot
                  ? `Move to ${formatTime(slot.startsAt, tz)}, ${formatLongDate(slot.startsAt, tz)}`
                  : "Choose a time"}
            </button>
            <button type="button" className={secondaryButton} onClick={close}>
              Back
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
