"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ApiErrorDto,
  AvailabilityResponse,
  BookingConfirmationDto,
  SlotDto,
} from "@/lib/booking-schema";
import { customerDetailsSchema } from "@/lib/booking-schema";
import {
  formatCalendarDate,
  formatDuration,
  formatLongDate,
  formatPrice,
  formatTime,
} from "@/lib/format";
import { addDays, isoWeekday } from "@/lib/calendar";
import type { Catalogue } from "@/server/catalogue";

const ANY_BARBER = "any";
const VISIBLE_DAYS = 14;

type AvailabilityState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; slots: SlotDto[] }
  | { status: "error"; message: string };

type Details = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  privacyAccepted: boolean;
};

export function BookingFlow({ catalogue, today }: { catalogue: Catalogue; today: string }) {
  const { shop, services, barbers, openingHours } = catalogue;
  // The form is server-rendered, so it is visible before React attaches its
  // handlers. A tap in that window would tick a radio natively without
  // updating state (service shown as selected, but no barbers listed).
  // Keep the first step disabled until hydration has finished.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [barberChoice, setBarberChoice] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotDto | null>(null);
  const [availability, setAvailability] = useState<AvailabilityState>({ status: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
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

  const service = services.find((s) => s.id === serviceId) ?? null;
  const eligibleBarbers = useMemo(
    () => barbers.filter((b) => serviceId && b.serviceIds.includes(serviceId)),
    [barbers, serviceId],
  );
  const days = useMemo(
    () => upcomingDays(today, Math.min(VISIBLE_DAYS, shop.bookingHorizonDays + 1)),
    [today, shop.bookingHorizonDays],
  );
  const closedWeekdays = new Set(
    openingHours.filter((d) => d.ranges.length === 0).map((d) => d.weekday),
  );

  const loadAvailability = useCallback(
    async (signal?: AbortSignal) => {
      if (!serviceId || !barberChoice || !date) return;
      setAvailability({ status: "loading" });
      const params = new URLSearchParams({ date, serviceId });
      if (barberChoice !== ANY_BARBER) params.set("barberId", barberChoice);
      try {
        const response = await fetch(`/api/availability?${params}`, { signal });
        if (!response.ok) throw new Error((await errorOf(response)).message);
        const body = (await response.json()) as AvailabilityResponse;
        setAvailability({ status: "ready", slots: body.slots });
      } catch (error) {
        if (signal?.aborted) return;
        setAvailability({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load times",
        });
      }
    },
    [serviceId, barberChoice, date],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on selection change
    void loadAvailability(controller.signal);
    return () => controller.abort();
  }, [loadAvailability]);

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
        }),
      });

      if (response.ok) {
        setConfirmation((await response.json()) as BookingConfirmationDto);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      const { code, message, fields } = await errorOf(response);
      if (code === "slot_unavailable") {
        // Someone else got there first: keep the customer's details, refresh the times.
        setSlot(null);
        idempotencyKey.current = null;
        setNotice(message);
        await loadAvailability();
        document.getElementById("step-time")?.scrollIntoView({ behavior: "smooth" });
      } else if (fields) {
        setFieldErrors(fields);
      } else {
        setNotice(message);
      }
    } catch {
      setNotice("Connection problem. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return <Confirmation booking={confirmation} timezone={shop.timezone} />;
  }

  const slots = availability.status === "ready" ? availability.slots : [];
  const morning = slots.filter((s) => formatTime(s.startsAt, shop.timezone) < "14:00");
  const afternoon = slots.filter((s) => formatTime(s.startsAt, shop.timezone) >= "14:00");

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
        <ChoiceGroup label="Day" scroll>
          {days.map((day) => {
            const closed = closedWeekdays.has(isoWeekday(day));
            return (
              <Choice
                key={day}
                name="date"
                value={day}
                checked={date === day}
                disabled={closed}
                onChange={() => {
                  setDate(day);
                  setSlot(null);
                  setNotice(null);
                }}
                title={formatCalendarDate(day, { day: "numeric" })}
                subtitle={formatCalendarDate(day, { weekday: "short", month: "short" })}
                compact
              />
            );
          })}
        </ChoiceGroup>
        <label className="text-muted mt-4 flex items-center gap-3 text-sm">
          Later date
          <input
            type="date"
            min={today}
            max={addDays(today, shop.bookingHorizonDays)}
            value={date ?? ""}
            onChange={(e) => {
              setDate(e.target.value || null);
              setSlot(null);
            }}
            className="border-border bg-surface text-foreground border px-3 py-2 [color-scheme:dark]"
          />
        </label>
      </Step>

      <Step number={4} title="Time" id="step-time" disabled={!date}>
        <div aria-live="polite">
          {notice && (
            <p
              role="alert"
              className="mb-4 border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-sm text-amber-200"
            >
              {notice}
            </p>
          )}
          {availability.status === "loading" && (
            <p className="text-muted text-sm">Checking availability…</p>
          )}
          {availability.status === "error" && (
            <p role="alert" className="text-sm text-red-300">
              {availability.message}
            </p>
          )}
          {availability.status === "ready" && slots.length === 0 && (
            <p className="text-muted text-sm">No times left on this day. Please try another one.</p>
          )}
        </div>
        {[
          ["Morning", morning],
          ["Afternoon", afternoon],
        ].map(([label, group]) =>
          (group as SlotDto[]).length === 0 ? null : (
            <div key={label as string} className="mb-6">
              <p className="text-muted mb-3 text-xs tracking-[0.2em] uppercase">
                {label as string}
              </p>
              <ChoiceGroup label={`${label} times`} columns={4}>
                {(group as SlotDto[]).map((s) => (
                  <Choice
                    key={s.startsAt}
                    name="time"
                    value={s.startsAt}
                    checked={slot?.startsAt === s.startsAt}
                    onChange={() => chooseSlot(s)}
                    title={formatTime(s.startsAt, shop.timezone)}
                    compact
                  />
                ))}
              </ChoiceGroup>
            </div>
          ),
        )}
      </Step>

      <Step number={5} title="Your details" disabled={!slot}>
        <div className="grid gap-4">
          <Field
            label="Full name"
            autoComplete="name"
            value={details.customerName}
            error={fieldErrors.customerName}
            onChange={(v) => setDetails({ ...details, customerName: v })}
          />
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={details.customerEmail}
            error={fieldErrors.customerEmail}
            onChange={(v) => setDetails({ ...details, customerEmail: v })}
          />
          <Field
            label="Phone"
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
              I agree that Chane Barber stores my details to manage this appointment.
              {fieldErrors.privacyAccepted && (
                <span className="mt-1 block text-red-300">{fieldErrors.privacyAccepted}</span>
              )}
            </span>
          </label>
        </div>
      </Step>

      {slot && service && (
        <div className="border-border bg-surface grid gap-4 border p-6">
          <p className="text-muted text-xs tracking-[0.2em] uppercase">Summary</p>
          <p className="font-display text-2xl">
            {service.name} · {formatLongDate(slot.startsAt, shop.timezone)},{" "}
            {formatTime(slot.startsAt, shop.timezone)}
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="bg-foreground text-background hover:bg-background hover:text-foreground border-foreground border px-8 py-4 text-sm tracking-[0.25em] uppercase transition-colors disabled:opacity-50"
          >
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
        Booked under <strong className="text-foreground">{booking.customerEmail}</strong>. Keep the
        link below: it is the only way to change or cancel this appointment online.
      </p>
      {booking.managePath && (
        <a
          href={booking.managePath}
          className="border-foreground hover:bg-foreground hover:text-background mx-auto border px-6 py-3 text-xs tracking-[0.2em] uppercase transition-colors"
        >
          Manage or cancel
        </a>
      )}
    </section>
  );
}

function Step({
  number,
  title,
  id,
  disabled = false,
  children,
}: {
  number: number;
  title: string;
  id?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <fieldset
      id={id}
      disabled={disabled}
      aria-labelledby={headingId}
      className="min-w-0 transition-opacity disabled:pointer-events-none disabled:opacity-30"
    >
      <legend id={headingId} className="mb-5 flex items-baseline gap-3">
        <span className="text-muted font-display text-sm italic">
          {String(number).padStart(2, "0")}
        </span>
        <span className="text-xs tracking-[0.25em] uppercase">{title}</span>
      </legend>
      {children}
    </fieldset>
  );
}

function ChoiceGroup({
  label,
  columns = 2,
  scroll = false,
  children,
}: {
  label: string;
  columns?: 2 | 3 | 4;
  scroll?: boolean;
  children: React.ReactNode;
}) {
  const layout = scroll
    ? "flex gap-2 overflow-x-auto pb-2 snap-x"
    : {
        2: "grid gap-2 sm:grid-cols-2",
        3: "grid gap-2 grid-cols-2 sm:grid-cols-3",
        4: "grid gap-2 grid-cols-3 sm:grid-cols-4",
      }[columns];
  return (
    <div role="radiogroup" aria-label={label} className={layout}>
      {children}
    </div>
  );
}

function Choice({
  name,
  value,
  checked,
  disabled,
  onChange,
  title,
  subtitle,
  compact = false,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <label
      className={`border-border hover:border-foreground has-checked:bg-foreground has-checked:text-background has-checked:border-foreground flex shrink-0 cursor-pointer snap-start flex-col border transition-colors has-focus-visible:outline has-disabled:pointer-events-none has-disabled:opacity-30 ${
        compact ? "items-center px-3 py-3 text-center" : "px-5 py-4"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <span className={compact ? "text-lg tabular-nums" : "font-display text-lg"}>{title}</span>
      {subtitle && <span className="text-xs opacity-60">{subtitle}</span>}
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-muted text-xs tracking-[0.2em] uppercase">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="border-border bg-surface focus:border-foreground border px-4 py-3 outline-none aria-invalid:border-red-400"
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

async function errorOf(response: Response): Promise<ApiErrorDto["error"]> {
  try {
    return ((await response.json()) as ApiErrorDto).error;
  } catch {
    return { code: "internal_error", message: "Something went wrong. Please try again." };
  }
}

const noopSubscribe = () => () => {};

function upcomingDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}
