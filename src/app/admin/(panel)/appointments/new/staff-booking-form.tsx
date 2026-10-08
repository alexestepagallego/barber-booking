"use client";

import { useState } from "react";

import { formatDuration } from "@/lib/format";

import { staffBook } from "../../../actions";
import { ActionForm, Input, Select, SubmitButton } from "../../../ui";
import { StaffSlotPicker } from "../../slot-picker";

export function StaffBookingForm({
  services,
  barbers,
  timezone,
  today,
}: {
  services: { id: string; name: string; durationMinutes: number }[];
  barbers: { id: string; name: string; serviceIds: string[] }[];
  timezone: string;
  today: string;
}) {
  const [serviceId, setServiceId] = useState<string>("");
  const eligible = barbers.filter((b) => !serviceId || b.serviceIds.includes(serviceId));

  return (
    <ActionForm action={staffBook} className="grid gap-6">
      <Select
        label="Service"
        name="serviceId"
        value={serviceId}
        onChange={(e) => setServiceId(e.target.value)}
        required
      >
        <option value="" disabled>
          Choose a service…
        </option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({formatDuration(s.durationMinutes)})
          </option>
        ))}
      </Select>

      {/* Remount when the service changes so the barber list and times reset. */}
      <StaffSlotPicker
        key={serviceId}
        serviceId={serviceId || null}
        barbers={eligible}
        timezone={timezone}
        today={today}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Customer name" name="customerName" autoComplete="off" required />
        <Input label="Phone" name="customerPhone" type="tel" autoComplete="off" />
        <Input
          label="Email (optional)"
          name="customerEmail"
          type="email"
          autoComplete="off"
          hint="If given, the customer gets the confirmation and manage link."
          className="sm:col-span-2"
        />
      </div>
      <div>
        <SubmitButton pendingLabel="Booking…">Book appointment</SubmitButton>
      </div>
    </ActionForm>
  );
}
