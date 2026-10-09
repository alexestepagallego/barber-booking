# HTTP API

The public pages use these JSON endpoints. Every input is validated on the server with Zod. The booking and reschedule bodies use the same schemas as the forms (`src/lib/booking-schema.ts`); headers and some query strings use small schemas in the route files.
The booking and manage endpoints never cache (`Cache-Control: no-store`), and their errors always have this shape (the cron and admin handlers answer unauthorized calls with a plain `401 { "error": "Unauthorized" }`):

```json
{
  "error": {
    "code": "validation_error",
    "message": "Some fields are not valid",
    "fields": { "customerEmail": "Please enter a valid email address" }
  }
}
```

| Status | `code`             | When                                                                                                                                          |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `validation_error` | Malformed input. For field errors, `fields` maps each field to a message; a bad `Idempotency-Key` or a body that is not JSON has no `fields`. |
| 400    | `bot_check_failed` | Honeypot filled in, or the Turnstile token is missing or invalid.                                                                             |
| 404    | `not_found`        | Unknown or inactive service or barber, or an unknown manage token (whatever its shape).                                                       |
| 409    | `slot_unavailable` | The time is not bookable: taken in the meantime, or outside the rules.                                                                        |
| 409    | `not_modifiable`   | The appointment is cancelled, has started, is past the online-change cutoff, or was just changed by someone else.                             |
| 429    | `rate_limited`     | Too many requests. `Retry-After` gives the seconds to wait.                                                                                   |
| 500    | `internal_error`   | Anything unexpected. Details are logged on the server (without personal data), never returned.                                                |
| 503    | `bot_check_failed` | Turnstile could not be reached (the check fails closed).                                                                                      |

## Booking

### `GET /api/availability`

Bookable start times for one shop-local day.

| Query param | Required |                                       |
| ----------- | -------- | ------------------------------------- |
| `date`      | yes      | `YYYY-MM-DD`, in the shop's time zone |
| `serviceId` | yes      | UUID                                  |
| `barberId`  | no       | UUID. Omit it for "no preference".    |

```json
{
  "date": "2026-10-08",
  "slots": [
    {
      "startsAt": "2026-10-08T07:00:00.000Z",
      "endsAt": "2026-10-08T07:45:00.000Z",
      "barberIds": ["…leo", "…chane"]
    }
  ]
}
```

`barberIds` lists the barbers free for that slot, least booked first. The
result is a hint: by the time the customer submits, the slot may be gone.
Rate limit: 120 per minute per IP.

### `POST /api/appointments`

| Header                           |                                                                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Type: application/json` | required                                                                                                                                                                                                                                                             |
| `Idempotency-Key: <uuid>`        | recommended. A retry with the same key returns the original booking (200) instead of creating another one or failing with 409. Only the key's hash is stored; the nightly maintenance cron clears hashes older than 24 h, so a key keeps working for 24 to 48 hours. |

```json
{
  "serviceId": "…",
  "barberId": null,
  "startsAt": "2026-10-08T10:00:00+02:00",
  "customerName": "Ana García",
  "customerEmail": "ana@example.com",
  "customerPhone": "+34 600 000 000",
  "privacyAccepted": true,
  "turnstileToken": "…",
  "website": ""
}
```

- `barberId: null` means "no preference". The least booked free barber is
  assigned; if one is taken meanwhile, the next one is tried.
- `startsAt` must include a UTC offset, and must be one of the start times
  availability offers at that moment. The overlap check itself happens in
  the database ([concurrency.md](concurrency.md)).
- `customerName` may contain letters (any script), spaces and `' ’ . -`.
- `turnstileToken` is required when Turnstile is configured, except for
  replays of an idempotency key. `website` is the honeypot and must be
  empty.
- Order of checks: Idempotency-Key format → JSON body → honeypot → validation → per-IP limit (10/h) → Turnstile → per-recipient limit (5/day) → booking. Turnstile and the recipient limit are skipped for idempotent replays, and the recipient counter only goes up once a booking has been created.

**201 Created**, or **200 OK** for a replay:

```json
{
  "id": "…",
  "startsAt": "2026-10-08T08:00:00.000Z",
  "endsAt": "2026-10-08T08:45:00.000Z",
  "barberName": "Chane",
  "serviceName": "Cut + beard trim",
  "customerName": "Ana García",
  "customerEmail": "ana@example.com",
  "managePath": "/manage/<43-character token>",
  "emailConfigured": true
}
```

`managePath` contains the secret for managing the booking.
`emailConfigured` is `false` when the app runs on Vercel without `RESEND_API_KEY` (emails are only logged), so the page does not promise a confirmation email. Locally emails are written to `./.mail`, and it is `true`.

## Managing a booking

All three endpoints take the manage token in
`Authorization: Bearer <token>`, never in the URL, so it stays out of
access logs. Malformed and unknown tokens get the same 404. Rate limits per IP: lookups share the 120-per-minute budget of `/api/availability`, and cancel and reschedule together get 30 per hour.

### `GET /api/manage/availability?date=YYYY-MM-DD`

Times this appointment can move to: same barber and service, and the
appointment keeps its own length. Its own current time does not count as
busy. Same response shape as `/api/availability`.

### `POST /api/manage/reschedule`

```json
{ "startsAt": "2026-10-09T17:00:00+02:00" }
```

### `POST /api/manage/cancel`

No body.

Both return the updated appointment:

```json
{
  "id": "…",
  "status": "confirmed",
  "startsAt": "…",
  "endsAt": "…",
  "barberName": "Chane",
  "serviceName": "Classic cut",
  "durationMinutes": 30,
  "priceCents": 1500,
  "customerName": "Ana García",
  "canModify": true,
  "modifiableUntil": "…",
  "calendarSequence": 1
}
```

`calendarSequence` is the iCalendar `SEQUENCE` of this version, the same
one the emailed invites use. A cancellation, or a reschedule that changes the time, also sends an email after the response; asking for the current time changes nothing.

## Scheduled jobs

`GET /api/cron/reminders` and `GET /api/cron/maintenance` require
`Authorization: Bearer $CRON_SECRET`; without it they return 401. Vercel
Cron calls them as configured in `vercel.json`. Both are safe to run more
than once; [architecture.md](architecture.md#scheduled-jobs-vercel-cron-verceljson)
says what each one does.

## Admin

The admin panel has no JSON API. It uses Server Actions
(`src/app/admin/actions.ts`), each of which checks the session itself, plus
two route handlers:

- `GET /admin/api/availability?date&serviceId&barberId[&exclude]`: staff
  availability (no minimum notice, one-year horizon, optionally for moving
  an existing appointment). It needs an admin session: a request without the session cookie is redirected to `/admin/login` by `proxy.ts`, and one with an invalid or expired session gets `401 { "error": "Unauthorized" }`.
- `POST /admin/logout`: ends the session and redirects to the login page.
