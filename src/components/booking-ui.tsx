"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { addDays, isoWeekday } from "@/lib/calendar";
import type { ApiErrorDto, AvailabilityResponse, SlotDto } from "@/lib/booking-schema";
import { formatCalendarDate, formatTime } from "@/lib/format";

/**
 * Building blocks shared by the booking form and the "manage your booking"
 * page: accessible step sections, radio-card choices, day and time pickers,
 * and an availability loader.
 */

const noopSubscribe = () => () => {};

/**
 * False during server rendering and hydration, true afterwards. Server-
 * rendered forms are visible before React attaches handlers, and a tap in
 * that window would tick a radio natively without updating state, so
 * interactive steps stay disabled until this is true.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export async function errorOf(response: Response): Promise<ApiErrorDto["error"]> {
  try {
    return ((await response.json()) as ApiErrorDto).error;
  } catch {
    return { code: "internal_error", message: "Something went wrong. Please try again." };
  }
}

export type AvailabilityState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; slots: SlotDto[] }
  | { status: "error"; message: string };

/**
 * Fetches availability whenever `url` changes (null means "not ready yet").
 * `reload()` refetches the current URL, e.g. after a 409.
 *
 * Every request (effect or reload) goes through one AbortController, so
 * starting a new request cancels the previous one, and a response that
 * belongs to an older URL can never overwrite the times of the day now
 * selected.
 */
export function useAvailability(url: string | null, headers?: Record<string, string>) {
  const [state, setState] = useState<AvailabilityState>({ status: "idle" });
  const headerKey = JSON.stringify(headers ?? {});
  const controllerRef = useRef<AbortController | null>(null);
  const urlRef = useRef(url);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    urlRef.current = url;
    if (!url) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: JSON.parse(headerKey),
      });
      if (!response.ok) throw new Error((await errorOf(response)).message);
      const body = (await response.json()) as AvailabilityResponse;
      if (controller.signal.aborted || urlRef.current !== url) return;
      setState({ status: "ready", slots: body.slots });
    } catch (error) {
      if (controller.signal.aborted || urlRef.current !== url) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load times",
      });
    }
  }, [url, headerKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching when the selection changes
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { state, reload: load };
}

export function Step({
  number,
  title,
  id,
  disabled = false,
  children,
}: {
  number?: number;
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
        {number !== undefined && (
          <span className="text-muted font-display text-sm italic">
            {String(number).padStart(2, "0")}
          </span>
        )}
        <span className="text-xs tracking-[0.25em] uppercase">{title}</span>
      </legend>
      {children}
    </fieldset>
  );
}

export function ChoiceGroup({
  label,
  columns = 2,
  scroll = false,
  disabled = false,
  children,
}: {
  label: string;
  columns?: 2 | 3 | 4;
  scroll?: boolean;
  /** A disabled scrolling strip is clipped instead of scrollable: nothing in it can be reached anyway. */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const layout = scroll
    ? `flex gap-2 pb-2 snap-x ${disabled ? "overflow-hidden" : "overflow-x-auto"}`
    : {
        2: "grid gap-2 sm:grid-cols-2",
        3: "grid gap-2 grid-cols-2 sm:grid-cols-3",
        4: "grid gap-2 grid-cols-3 sm:grid-cols-4",
      }[columns];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={layout}
      // A horizontally scrolling strip must be reachable by keyboard
      // (WCAG 2.1.1, axe scrollable-region-focusable).
      tabIndex={scroll && !disabled ? 0 : undefined}
    >
      {children}
    </div>
  );
}

export function Choice({
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
  // `relative` contains the visually hidden (absolutely positioned) radio.
  // Without it, the radios of a horizontally scrolling strip escape the
  // scroll container, widen the document and make mobile browsers zoom out.
  return (
    <label
      className={`border-border hover:border-foreground has-checked:bg-foreground has-checked:text-background has-checked:border-foreground relative flex shrink-0 cursor-pointer snap-start flex-col border transition-colors has-focus-visible:outline has-disabled:pointer-events-none has-disabled:opacity-30 ${
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

export function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
  name?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-muted text-xs tracking-[0.2em] uppercase">
        {label}
      </label>
      <input
        id={id}
        name={name}
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

const VISIBLE_DAYS = 14;

/** Two weeks of day cards plus a native date input for later dates. */
export function DayPicker({
  today,
  horizonDays,
  closedWeekdays,
  value,
  onChange,
  disabled = false,
}: {
  today: string;
  horizonDays: number;
  closedWeekdays: ReadonlySet<number>;
  value: string | null;
  onChange: (date: string | null) => void;
  disabled?: boolean;
}) {
  const days = Array.from({ length: Math.min(VISIBLE_DAYS, horizonDays + 1) }, (_, i) =>
    addDays(today, i),
  );
  return (
    <>
      <ChoiceGroup label="Day" scroll disabled={disabled}>
        {days.map((day) => (
          <Choice
            key={day}
            name="date"
            value={day}
            checked={value === day}
            disabled={closedWeekdays.has(isoWeekday(day))}
            onChange={() => onChange(day)}
            title={formatCalendarDate(day, { day: "numeric" })}
            subtitle={formatCalendarDate(day, { weekday: "short", month: "short" })}
            compact
          />
        ))}
      </ChoiceGroup>
      <label className="text-muted mt-4 flex items-center gap-3 text-sm">
        Later date
        <input
          type="date"
          min={today}
          max={addDays(today, horizonDays)}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="border-border bg-surface text-foreground border px-3 py-2 [color-scheme:dark]"
        />
      </label>
    </>
  );
}

/** Available times grouped into morning and afternoon, with loading and empty states. */
export function TimePicker({
  availability,
  timezone,
  value,
  onChange,
  notice,
}: {
  availability: AvailabilityState;
  timezone: string;
  value: string | null;
  onChange: (slot: SlotDto) => void;
  notice?: string | null;
}) {
  const slots = availability.status === "ready" ? availability.slots : [];
  const groups = [
    { label: "Morning", slots: slots.filter((s) => formatTime(s.startsAt, timezone) < "14:00") },
    { label: "Afternoon", slots: slots.filter((s) => formatTime(s.startsAt, timezone) >= "14:00") },
  ];

  return (
    <>
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
      {groups.map((group) =>
        group.slots.length === 0 ? null : (
          <div key={group.label} className="mb-6">
            <p className="text-muted mb-3 text-xs tracking-[0.2em] uppercase">{group.label}</p>
            <ChoiceGroup label={`${group.label} times`} columns={4}>
              {group.slots.map((s) => (
                <Choice
                  key={s.startsAt}
                  name="time"
                  value={s.startsAt}
                  checked={value === s.startsAt}
                  onChange={() => onChange(s)}
                  title={formatTime(s.startsAt, timezone)}
                  compact
                />
              ))}
            </ChoiceGroup>
          </div>
        ),
      )}
    </>
  );
}

export const primaryButton =
  "bg-foreground text-background hover:bg-background hover:text-foreground border-foreground border px-8 py-4 text-sm tracking-[0.25em] uppercase transition-colors disabled:opacity-50";

export const secondaryButton =
  "border-foreground hover:bg-foreground hover:text-background border px-6 py-3 text-xs tracking-[0.2em] uppercase transition-colors disabled:opacity-50";
