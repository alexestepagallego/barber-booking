import type { Metadata } from "next";
import { Suspense } from "react";

import { loadAdminCatalogue } from "@/server/admin/catalogue-admin";
import { requireAdminPage } from "@/server/admin/session";
import { localDate } from "@/server/booking/availability";
import { getDb } from "@/server/db/client";

import { StaffBookingForm } from "./staff-booking-form";

export const metadata: Metadata = { title: "New booking" };

export default function NewBookingPage() {
  return (
    <div className="grid max-w-2xl gap-8">
      <div>
        <h1 className="font-display text-4xl italic">New booking</h1>
        <p className="text-muted mt-1 text-sm">
          For walk-ins and phone bookings. The minimum notice does not apply, but overlapping
          appointments are still impossible.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Loader />
      </Suspense>
    </div>
  );
}

async function Loader() {
  await requireAdminPage();
  const { settings, services, barbers } = await loadAdminCatalogue(getDb());
  return (
    <StaffBookingForm
      services={services
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes }))}
      barbers={barbers
        .filter((b) => b.active)
        .map((b) => ({ id: b.id, name: b.name, serviceIds: b.serviceIds }))}
      timezone={settings.timezone}
      today={localDate(new Date(), settings.timezone)}
    />
  );
}
