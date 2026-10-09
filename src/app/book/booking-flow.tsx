"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Choice,
  ChoiceGroup,
  DayPicker,
  errorOf,
  Field,
  primaryButton,
  secondaryButton,
  Step,
  TimePicker,
  useAvailability,
  useHydrated,
} from "@/components/booking-ui";
import { TurnstileWidget, turnstileEnabled } from "@/components/turnstile-widget";
import type { BookingConfirmationDto, SlotDto } from "@/lib/booking-schema";
import { customerDetailsSchema } from "@/lib/booking-schema";
import { formatDuration, formatLongDate, formatPrice, formatTime } from "@/lib/format";
import type { Catalogue } from "@/server/catalogue";

const ANY_BARBER = "any";

type Details = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  privacyAccepted: boolean;
};

export function BookingFlow({ catalogue, today }: { catalogue: Catalogue; today: string }) {
  const { shop, services, barbers, openingHours } = catalogue;
  const hydrated = useHydrated();

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [barberChoice, setBarberChoice] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  /** Messages about the chosen time (shown in the time step). */
  const [notice, setNotice] = useState<string | null>(null);
  /** Messages about the submission itself (shown next to the button). */
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [details, setDetails] = useState<Details>({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    privacyAccepted: false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<BookingConfirmationDto | null>(null);
  // One key per attempted booking: reused if the same submission is retried,
  // so a double tap or a flaky network never creates two appointments.
  const idempotencyKey = useRef<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // After a network failure the booking may have been saved: the retry reuses
  // the idempotency key (and the server answers it without a new token).
  // After any other error a fresh verification token is required.
  const retryingAfterNetworkError = useRef(false);
  const [turnstileReset, setTurnstileReset] = useState(0);
  // Honeypot: hidden from people, so only bots ever fill it in.
  const [website, setWebsite] = useState("");

  const service = services.find((s) => s.id === serviceId) ?? null;
  const eligibleBarbers = useMemo(
    () => barbers.filter((b) => serviceId && b.serviceIds.includes(serviceId)),
    [barbers, serviceId],
  );
  const closedWeekdays = useMemo(
    () => new Set(openingHours.filter((d) => d.ranges.length === 0).map((d) => d.weekday)),
    [openingHours],
  );

  const availabilityUrl =
    serviceId && barberChoice && date
      ? `/api/availability?${new URLSearchParams({
          date,
          serviceId,
          ...(barberChoice !== ANY_BARBER && { barberId: barberChoice }),
        })}`
      : null;
  const { state: availability, reload } = useAvailability(availabilityUrl);

  function chooseService(id: string) {
    setServiceId(id);
    // The previous barber may not offer the new service.
    const stillEligible =
      barberChoice === ANY_BARBER ||
      barbers.find((b) => b.id === barberChoice)?.serviceIds.includes(id);
    if (!stillEligible) setBarberChoice(null);
    setSlot(null);
    setNotice(null);
  }

  function chooseSlot(next: SlotDto) {
    setSlot(next);
    setNotice(null);
    idempotencyKey.current = null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!serviceId || !barberChoice || !slot || submitting) return;

    const parsed = customerDetailsSchema.safeParse(details);
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      return;
    }
    setFieldErrors({});
    setFormNotice(null);
    if (turnstileEnabled && !turnstileToken && !retryingAfterNetworkError.current) {
      setFormNotice("Please complete the verification above the button.");
      return;
    }
    setSubmitting(true);
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          ...details,
          serviceId,
          barberId: barberChoice === ANY_BARBER ? null : barberChoice,
          startsAt: slot.startsAt,
          turnstileToken: turnstileToken ?? undefined,
          website,
        }),
      });

      retryingAfterNetworkError.current = false;
      if (response.ok) {
        setConfirmation((await response.json()) as BookingConfirmationDto);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      const { code, message, fields } = await errorOf(response);
      // Verification tokens are single-use: get a fresh one for the next attempt.
      setTurnstileReset((n) => n + 1);
      if (code === "slot_unavailable") {
        // Someone else got there first: keep the customer's details, refresh the times.
        setSlot(null);
        idempotencyKey.current = null;
        setNotice(message);
        await reload();
        document.getElementById("step-time")?.scrollIntoView({ behavior: "smooth" });
      } else if (fields) {
        setFieldErrors(fields);
      } else {
        setFormNotice(message);
      }
    } catch {
      // Keep the idempotency key: retrying the same booking is safe.
      retryingAfterNetworkError.current = true;
      setFormNotice("Connection problem. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return <Confirmation booking={confirmation} timezone={shop.timezone} />;
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-12">
      <Step number={1} title="Service" disabled={!hydrated}>
        <ChoiceGroup label="Service">
          {services.map((s) => (
            <Choice
              key={s.id}
              name="service"
              value={s.id}
              checked={serviceId === s.id}
              onChange={() => chooseService(s.id)}
              title={s.name}
              subtitle={`${formatDuration(s.durationMinutes)} · ${formatPrice(s.priceCents)}`}
            />
          ))}
        </ChoiceGroup>
      </Step>

      <Step number={2} title="Barber" disabled={!service}>
        <ChoiceGroup label="Barber" columns={3}>
          {eligibleBarbers.map((b) => (
            <Choice
              key={b.id}
              name="barber"
              value={b.id}
              checked={barberChoice === b.id}
              onChange={() => {
                setBarberChoice(b.id);
                setSlot(null);
              }}
              title={b.name}
              subtitle="Barber"
            />
          ))}
          <Choice
            name="barber"
            value={ANY_BARBER}
            checked={barberChoice === ANY_BARBER}
            onChange={() => {
              setBarberChoice(ANY_BARBER);
              setSlot(null);
            }}
            title="No preference"
            subtitle="First available"
          />
        </ChoiceGroup>
      </Step>

      <Step number={3} title="Day" disabled={!barberChoice}>
        <DayPicker
          disabled={!barberChoice}
          today={today}
          horizonDays={shop.bookingHorizonDays}
          closedWeekdays={closedWeekdays}
          value={date}
          onChange={(next) => {
            setDate(next);
            setSlot(null);
            setNotice(null);
          }}
        />
      </Step>

      <Step number={4} title="Time" id="step-time" disabled={!date}>
        <TimePicker
          availability={availability}
          timezone={shop.timezone}
          value={slot?.startsAt ?? null}
          onChange={chooseSlot}
          notice={notice}
        />
      </Step>

      <Step number={5} title="Your details" disabled={!slot}>
        <div className="grid gap-4">
          <Field
            label="Full name"
            name="name"
            autoComplete="name"
            value={details.customerName}
            error={fieldErrors.customerName}
            onChange={(v) => setDetails({ ...details, customerName: v })}
          />
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={details.customerEmail}
            error={fieldErrors.customerEmail}
            onChange={(v) => setDetails({ ...details, customerEmail: v })}
          />
          <Field
            label="Phone"
            name="tel"
            type="tel"
            autoComplete="tel"
            value={details.customerPhone}
            error={fieldErrors.customerPhone}
            onChange={(v) => setDetails({ ...details, customerPhone: v })}
          />
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={details.privacyAccepted}
              onChange={(e) => setDetails({ ...details, privacyAccepted: e.target.checked })}
              aria-invalid={Boolean(fieldErrors.privacyAccepted)}
              className="mt-1 accent-white"
            />
            <span className="text-muted">
              I agree that Chane Barber stores my details to manage this appointment, as described
              in the{" "}
              <a href="/privacy" target="_blank" className="text-foreground underline">
                privacy policy
              </a>
              .
              {fieldErrors.privacyAccepted && (
                <span className="mt-1 block text-red-300">{fieldErrors.privacyAccepted}</span>
              )}
            </span>
          </label>
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label>
              Leave this field empty
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>
          <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} />
        </div>
      </Step>

      {slot && service && (
        <div className="border-border bg-surface grid gap-4 border p-6">
          <p className="text-muted text-xs tracking-[0.2em] uppercase">Summary</p>
          <p className="font-display text-2xl">
            {service.name} · {formatLongDate(slot.startsAt, shop.timezone)},{" "}
            {formatTime(slot.startsAt, shop.timezone)}
          </p>
          {formNotice && (
            <p role="alert" className="text-sm text-red-300">
              {formNotice}
            </p>
          )}
          <button type="submit" disabled={submitting} className={primaryButton}>
            {submitting ? "Booking…" : "Confirm booking"}
          </button>
        </div>
      )}
    </form>
  );
}

function Confirmation({
  booking,
  timezone,
}: {
  booking: BookingConfirmationDto;
  timezone: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <section className="border-border bg-surface grid gap-6 border p-8 text-center">
      <h2 ref={headingRef} tabIndex={-1} className="font-display text-4xl italic outline-none">
        See you soon, {booking.customerName.split(" ")[0]}
      </h2>
      <div className="bg-foreground mx-auto h-px w-12" />
      <dl className="grid gap-2">
        <dt className="sr-only">Service</dt>
        <dd className="font-display text-2xl">{booking.serviceName}</dd>
        <dt className="sr-only">When</dt>
        <dd>
          {formatLongDate(booking.startsAt, timezone)} at {formatTime(booking.startsAt, timezone)}
        </dd>
        <dt className="sr-only">Barber</dt>
        <dd className="text-muted">with {booking.barberName}</dd>
      </dl>
      <p className="text-muted text-sm">
        {booking.emailConfigured ? (
          <>
            A confirmation is on its way to{" "}
            <strong className="text-foreground">{booking.customerEmail}</strong>, with a calendar
            invite and a link to change or cancel the appointment.
          </>
        ) : (
          <>
            Booked under <strong className="text-foreground">{booking.customerEmail}</strong>.
          </>
        )}{" "}
        You can also keep the link below: it lets you change or cancel online.
      </p>
      <a href={booking.managePath} className={`${secondaryButton} mx-auto`}>
        Manage or cancel
      </a>
    </section>
  );
}
