# ADR 0003: Derive manage-link tokens with HMAC, store only their hash

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Customers have no accounts. They manage a booking through a secret link,
`/manage/<token>`. Anyone holding the link can cancel or move the
appointment, so the token must be unguessable, and a copy of the database
must not be enough to use it.

The first version generated 32 random bytes per booking and stored only the
token's SHA-256 hash. That protects the database, but the server could
never rebuild the link afterwards. Every later email had no way to include
a link to manage the booking: the reminder ("Can't make it? Cancel here"),
the email after a reschedule, and anything sent by staff. Storing the raw
token, or encrypting it reversibly, would bring back the leak the hash
prevents.

## Decision

The token is derived, not random:

```
token = base64url( HMAC-SHA256( MANAGE_LINK_SECRET, "manage:" + appointmentId ) )   // 43 chars
stored = SHA-256(token)
```

- The appointment id is generated in the app (`randomUUID()`) so the hash
  can be inserted in the same `INSERT`.
- Lookups hash the presented token and match `manage_token_hash`, so
  nothing changes on the read path.
- Any email can rebuild the link from the id plus the server secret.
- An idempotent replay of a booking request can now return the link too.

## Consequences

- **Security rests on the secret.** Someone with the database dump but not
  `MANAGE_LINK_SECRET` can neither recover nor forge links. Someone with
  both could forge links, but at that point they already have the data.
  The secret is required in production (at least 32 characters): without it, every request that needs a manage link fails loudly instead of falling back to a weak default. Outside production a development default is used, which is why `npm run tokens:rehash` refuses to run unless the real secret is set.
- **Rotation is the emergency brake.** Changing the secret invalidates every
  link at once. `npm run tokens:rehash` then rewrites the stored hashes, so
  emails sent after the rotation carry working links again. The procedure
  is in [security.md](../security.md#rotating-manage_link_secret).
- Tokens are 256-bit HMAC outputs, so brute force is not a practical threat.
  Rate limits and uniform 404s are defence in depth.
- Links never expire on their own. They stop being useful once the
  appointment is cancelled or has started, and the customer data behind
  them is erased after the retention period.
