import type { Metadata } from "next";
import { Suspense } from "react";

import { loadAdminCatalogue } from "@/server/admin/catalogue-admin";
import { requireAdminPage } from "@/server/admin/session";
import { getDb } from "@/server/db/client";

import { saveBarberAction } from "../../actions";
import { ActionForm, Checkbox, Input, SubmitButton } from "../../ui";

export const metadata: Metadata = { title: "Barbers" };

export default function BarbersPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-display text-4xl italic">Barbers</h1>
        <p className="text-muted mt-1 text-sm">
          Deactivating a barber hides them from new bookings; their existing appointments stay. Set
          working hours in{" "}
          <a href="/admin/schedule" className="underline">
            Hours &amp; time off
          </a>
          .
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <BarberList />
      </Suspense>
    </div>
  );
}

async function BarberList() {
  await requireAdminPage();
  const { barbers, services } = await loadAdminCatalogue(getDb());
  const serviceOptions = services.map((s) => ({ id: s.id, name: s.name, active: s.active }));
  return (
    <div className="grid gap-4">
      {barbers.map((barber) => (
        <BarberForm key={barber.id} barber={barber} services={serviceOptions} />
      ))}
      <details className="border-border border p-5">
        <summary className="cursor-pointer text-xs tracking-[0.2em] uppercase">
          Add a barber
        </summary>
        <div className="mt-5">
          <BarberForm services={serviceOptions} />
        </div>
      </details>
    </div>
  );
}

function BarberForm({
  barber,
  services,
}: {
  barber?: {
    id: string;
    name: string;
    bio: string | null;
    sortOrder: number;
    active: boolean;
    serviceIds: string[];
  };
  services: { id: string; name: string; active: boolean }[];
}) {
  return (
    <ActionForm
      action={saveBarberAction}
      resetOnSuccess={!barber}
      className={`grid gap-4 ${barber ? "border-border bg-surface border p-5" : ""}`}
    >
      <input type="hidden" name="id" value={barber?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr_80px]">
        <Input label="Name" name="name" defaultValue={barber?.name} required />
        <Input label="Short bio" name="bio" defaultValue={barber?.bio ?? ""} />
        <Input
          label="Order"
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={barber?.sortOrder ?? 0}
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-muted mb-2 text-xs tracking-[0.15em] uppercase">
          Services offered
        </legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {services.map((s) => (
            <Checkbox
              key={s.id}
              label={s.active ? s.name : `${s.name} (inactive)`}
              name="serviceIds"
              value={s.id}
              defaultChecked={barber ? barber.serviceIds.includes(s.id) : s.active}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-6">
        <Checkbox label="Active" name="active" defaultChecked={barber?.active ?? true} />
        <SubmitButton>{barber ? "Save" : "Add barber"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
