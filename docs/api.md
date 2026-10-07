# HTTP API

The public booking page uses two JSON endpoints. Both validate every input
on the server with the same Zod schemas the form uses
(`src/lib/booking-schema.ts`), never cache their responses, and return
errors in one shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Some fields are not valid",
    "fields": { "customerEmail": "Please enter a valid email address" }
  }
}
```

| Status | `code`             | When                                                                          |
| ------ | ------------------ | ----------------------------------------------------------------------------- |
| 400    | `validation_error` | Malformed input. `fields` maps each invalid field to a message.               |
| 404    | `not_found`        | Unknown or inactive service or barber.                                        |
| 409    | `slot_unavailable` | The time is not bookable, whether taken in the meantime or outside the rules. |
| 500    | `internal_error`   | Anything unexpected. Details are logged on the server, never returned.        |

## `GET /api/availability`

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

`barberIds` lists the barbers free for that slot, least booked first.
The result is a hint: by the time the customer submits, the slot may be
gone.

## `POST /api/appointments`

| Header                           |                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Content-Type: application/json` | required                                                                                                                    |
| `Idempotency-Key: <uuid>`        | recommended. Retrying with the same key returns the original booking (200) instead of creating another or failing with 409. |

```json
{
  "serviceId": "…",
  "barberId": null,
  "startsAt": "2026-10-08T10:00:00+02:00",
  "customerName": "Ana García",
  "customerEmail": "ana@example.com",
  "customerPhone": "+34 600 000 000",
  "privacyAccepted": true
}
```

- `barberId: null` means "no preference". The least booked free barber is
  assigned, and if one is taken in the meantime the next one is tried.
- `startsAt` must include a UTC offset. It must be one of the start times
  availability offers at that moment (opening hours, service duration,
  notice, horizon, time off). The overlap check itself happens in the
  database ([concurrency.md](concurrency.md)).

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
  "managePath": "/manage/<256-bit token>"
}
```

`managePath` carries the secret for managing the booking. It is returned
once; a replay returns `null`, because only the token's hash is stored.
