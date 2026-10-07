/** The requested time overlaps a confirmed appointment of that barber. Maps to HTTP 409. */
export class SlotUnavailableError extends Error {
  readonly name = "SlotUnavailableError";

  constructor(message = "That time slot is no longer available") {
    super(message);
  }
}
