import type { Metadata } from "next";
import { Suspense } from "react";

import { loadAdminCatalogue } from "@/server/admin/catalogue-admin";
import { requireAdmin } from "@/server/admin/session";
import { getDb } from "@/server/db/client";

import { saveSettingsAction } from "../../actions";
import { ActionForm, Input, Select, SubmitButton } from "../../ui";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="grid max-w-2xl gap-8">
      <h1 className="font-display text-4xl italic">Settings</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <SettingsForm />
      </Suspense>
    </div>
  );
}

async function SettingsForm() {
  await requireAdmin();
  const { settings } = await loadAdminCatalogue(getDb());
  return (
    <ActionForm action={saveSettingsAction} className="grid gap-6">
      <fieldset className="grid gap-4">
        <legend className="mb-2 text-xs tracking-[0.2em] uppercase">Shop</legend>
        <Input label="Name" name="name" defaultValue={settings.name} required />
        <Input
          label="Phone"
          name="phone"
          type="tel"
          defaultValue={settings.phone ?? ""}
          hint="Shown to customers who can no longer change a booking online."
        />
        <Input
          label="Address"
          name="address"
          defaultValue={settings.address ?? ""}
          hint="Used in emails and calendar invites."
        />
        <p className="text-muted text-sm">Time zone: {settings.timezone}</p>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs tracking-[0.2em] uppercase">Booking rules</legend>
        <Select
          label="Start times every"
          name="slotIntervalMinutes"
          defaultValue={String(settings.slotIntervalMinutes)}
        >
          {[5, 10, 15, 20, 30, 60].map((n) => (
            <option key={n} value={n}>
              {n} minutes
            </option>
          ))}
        </Select>
        <Input
          label="Book up to (days ahead)"
          name="bookingHorizonDays"
          type="number"
          min={1}
          max={365}
          defaultValue={settings.bookingHorizonDays}
        />
        <Input
          label="Minimum notice (minutes)"
          name="minNoticeMinutes"
          type="number"
          min={0}
          defaultValue={settings.minNoticeMinutes}
          hint="How soon before the start customers can still book."
        />
        <Input
          label="Online changes until (minutes before)"
          name="cancellationCutoffMinutes"
          type="number"
          min={0}
          defaultValue={settings.cancellationCutoffMinutes}
          hint="After this, customers must call."
        />
      </fieldset>
      <div>
        <SubmitButton>Save settings</SubmitButton>
      </div>
    </ActionForm>
  );
}
