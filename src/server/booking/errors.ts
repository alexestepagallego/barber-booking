/** The requested time overlaps a confirmed appointment of that barber. Maps to HTTP 409. */
export class SlotUnavailableError extends Error {
  readonly name = "SlotUnavailableError";

  constructor(message = "That time slot is no longer available") {
    super(message);
  }
}

/** A referenced service or barber does not exist or is inactive. Maps to HTTP 404. */
export class NotFoundError extends Error {
  readonly name = "NotFoundError";
}

export type NotModifiableReason = "not_confirmed" | "past" | "too_late" | "not_started" | "changed";

const NOT_MODIFIABLE_MESSAGES: Record<NotModifiableReason, string> = {
  not_confirmed: "This appointment is no longer active.",
  past: "This appointment has already started.",
  too_late: "It is too late to change this appointment online. Please call the shop.",
  not_started: "This appointment has not started yet.",
  changed: "This appointment was just changed. Please reload the page.",
};

/** The appointment exists but its state does not allow the change. Maps to HTTP 409. */
export class NotModifiableError extends Error {
  readonly name = "NotModifiableError";

  constructor(readonly reason: NotModifiableReason) {
    super(NOT_MODIFIABLE_MESSAGES[reason]);
  }
}
