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
