"use client";

import { useEffect, useRef, useState } from "react";

import { TimePicker, useAvailability } from "@/components/booking-ui";
import type { SlotDto } from "@/lib/booking-schema";

import { useActionResult } from "../ui";

/**
 * Barber + date + time selection for staff, backed by /admin/api/availability
 * (no minimum notice, longer horizon). The chosen slot is submitted with the
 * surrounding form through hidden inputs named barberId and startsAt.
 */
export function StaffSlotPicker({
  serviceId,
  barbers,
  timezone,
  today,
  defaultBarberId,
  excludeAppointmentId,
}: {
  serviceId: string | null;
  barbers: { id: string; name: string }[];
  timezone: string;
  today: string;
  defaultBarberId?: string;
  excludeAppointmentId?: string;
}) {
  // The appointment's own barber may have been deactivated since: only
  // preselect it if it is still one of the options shown.
  const [barberId, setBarberId] = useState(
    barbers.some((b) => b.id === defaultBarberId) ? defaultBarberId! : (barbers[0]?.id ?? ""),
  );
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<SlotDto | null>(null);

  const url =
    serviceId && barberId && date
      ? `/admin/api/availability?${new URLSearchParams({
          serviceId,
          barberId,
          date,
          ...(excludeAppointmentId && { exclude: excludeAppointmentId }),
        })}`
      : null;
  const { state, reload } = useAvailability(url);

  // When the action reports that the time was just taken, drop the
  // selection and refresh the list, like the public booking form does.
  const result = useActionResult();
  const handled = useRef(result);
  useEffect(() => {
    if (result === handled.current) return;
    handled.current = result;
    if (result.code === "slot_unavailable") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the action result
      setSlot(null);
      void reload();
    }
  }, [result, reload]);

  if (barbers.length === 0) {
    return (
      <p className="text-muted text-sm">
        No active barber offers this service. Assign it to a barber on the Barbers page first.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-muted text-xs tracking-[0.15em] uppercase">Barber</span>
          <select
            name="barberId"
            value={barberId}
            onChange={(e) => {
              setBarberId(e.target.value);
              setSlot(null);
            }}
            className="border-border bg-surface border px-3 py-2 [color-scheme:dark]"
          >
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-muted text-xs tracking-[0.15em] uppercase">Day</span>
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => {
              setDate(e.target.value);
              setSlot(null);
            }}
            className="border-border bg-surface border px-3 py-2 [color-scheme:dark]"
          />
        </label>
      </div>
      {serviceId ? (
        <TimePicker
          availability={state}
          timezone={timezone}
          value={slot?.startsAt ?? null}
          onChange={setSlot}
        />
      ) : (
        <p className="text-muted text-sm">Choose a service first.</p>
      )}
      <input type="hidden" name="startsAt" value={slot?.startsAt ?? ""} />
    </div>
  );
}
