"use client";

import { useState } from "react";

import { TimePicker, useAvailability } from "@/components/booking-ui";
import type { SlotDto } from "@/lib/booking-schema";

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
  const [barberId, setBarberId] = useState(defaultBarberId ?? barbers[0]?.id ?? "");
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
  const { state } = useAvailability(url);

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
