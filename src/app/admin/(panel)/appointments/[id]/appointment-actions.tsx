"use client";

import { useState } from "react";

import { staffCancel, staffOutcome, staffReschedule } from "../../../actions";
import { ActionForm, SubmitButton } from "../../../ui";
import { StaffSlotPicker } from "../../slot-picker";

export function AppointmentActions({
  appointmentId,
  serviceId,
  status,
  started,
  barberId,
  barbers,
  timezone,
  today,
}: {
  appointmentId: string;
  serviceId: string;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
  started: boolean;
  barberId: string;
  barbers: { id: string; name: string }[];
  timezone: string;
  today: string;
}) {
  const [rescheduling, setRescheduling] = useState(false);
  // A mis-tap must not cancel a booking and email the customer.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  if (status !== "confirmed") return null;

  return (
    <section aria-labelledby="actions-heading" className="grid gap-6">
      <h2 id="actions-heading" className="text-xs tracking-[0.2em] uppercase">
        Actions
      </h2>

      {started ? (
        <ActionForm action={staffOutcome} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <SubmitButton name="outcome" value="completed" pendingLabel="Saving…">
            Mark completed
          </SubmitButton>
          <SubmitButton name="outcome" value="no_show" variant="secondary" pendingLabel="Saving…">
            Mark no-show
          </SubmitButton>
        </ActionForm>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setRescheduling((r) => !r)}
            aria-expanded={rescheduling}
            className="border-foreground hover:bg-foreground hover:text-background border px-5 py-2.5 text-xs tracking-[0.2em] uppercase"
          >
            {rescheduling ? "Close" : "Move appointment"}
          </button>
          {confirmingCancel ? (
            <ActionForm action={staffCancel} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="appointmentId" value={appointmentId} />
              <span className="text-sm">Cancel and notify the customer?</span>
              <SubmitButton variant="danger" pendingLabel="Cancelling…">
                Yes, cancel it
              </SubmitButton>
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                className="text-muted text-xs tracking-[0.2em] uppercase underline"
              >
                Keep it
              </button>
            </ActionForm>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="border border-red-400/60 px-5 py-2.5 text-xs tracking-[0.2em] text-red-200 uppercase hover:bg-red-400/10"
            >
              Cancel appointment
            </button>
          )}
        </div>
      )}

      {rescheduling && !started && (
        <ActionForm action={staffReschedule} className="border-border grid gap-4 border p-5">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <StaffSlotPicker
            serviceId={serviceId}
            barbers={barbers}
            timezone={timezone}
            today={today}
            defaultBarberId={barberId}
            excludeAppointmentId={appointmentId}
          />
          <div>
            <SubmitButton pendingLabel="Moving…">Move here</SubmitButton>
          </div>
        </ActionForm>
      )}
    </section>
  );
}
