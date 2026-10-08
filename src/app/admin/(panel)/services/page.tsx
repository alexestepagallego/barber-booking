import type { Metadata } from "next";
import { Suspense } from "react";

import { loadAdminCatalogue } from "@/server/admin/catalogue-admin";
import { requireAdminPage } from "@/server/admin/session";
import { getDb } from "@/server/db/client";

import { saveServiceAction } from "../../actions";
import { ActionForm, Checkbox, Input, SubmitButton } from "../../ui";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-display text-4xl italic">Services</h1>
        <p className="text-muted mt-1 text-sm">
          Services with bookings cannot be deleted; deactivate them to hide them from the booking
          page. Changing a duration only affects new bookings.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ServiceList />
      </Suspense>
    </div>
  );
}

async function ServiceList() {
  await requireAdminPage();
  const { services } = await loadAdminCatalogue(getDb());
  return (
    <div className="grid gap-4">
      {services.map((service) => (
        <ServiceForm key={service.id} service={service} />
      ))}
      <details className="border-border border p-5">
        <summary className="cursor-pointer text-xs tracking-[0.2em] uppercase">
          Add a service
        </summary>
        <div className="mt-5">
          <ServiceForm />
        </div>
      </details>
    </div>
  );
}

function ServiceForm({
  service,
}: {
  service?: {
    id: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    priceCents: number;
    sortOrder: number;
    active: boolean;
  };
}) {
  return (
    <ActionForm
      action={saveServiceAction}
      resetOnSuccess={!service}
      className={`grid gap-4 sm:grid-cols-[2fr_1fr_1fr_80px] sm:items-end ${service ? "border-border bg-surface border p-5" : ""}`}
    >
      <input type="hidden" name="id" value={service?.id ?? ""} />
      <Input label="Name" name="name" defaultValue={service?.name} required />
      <Input
        label="Minutes"
        name="durationMinutes"
        type="number"
        min={5}
        step={5}
        defaultValue={service?.durationMinutes ?? 30}
        required
      />
      <Input
        label="Price (€)"
        name="price"
        type="number"
        min={0}
        step={0.5}
        defaultValue={service ? service.priceCents / 100 : 15}
        required
      />
      <Input
        label="Order"
        name="sortOrder"
        type="number"
        min={0}
        defaultValue={service?.sortOrder ?? 0}
      />
      <Input
        label="Description"
        name="description"
        defaultValue={service?.description ?? ""}
        className="sm:col-span-3"
      />
      <div className="flex items-center gap-4 sm:justify-end">
        <Checkbox label="Active" name="active" defaultChecked={service?.active ?? true} />
      </div>
      <div className="sm:col-span-4">
        <SubmitButton>{service ? "Save" : "Add service"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
