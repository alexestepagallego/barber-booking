-- Existing appointments get the price their service has today: the best
-- available approximation of what they were booked at.
UPDATE "appointments" a
SET "price_cents" = s."price_cents"
FROM "services" s
WHERE s."id" = a."service_id" AND a."price_cents" IS NULL;
--> statement-breakpoint

-- Keep idempotent replays working for existing keys, now looked up by hash.
-- sha256() is built into PostgreSQL 11+; the app hashes the key's text form
-- the same way (hex of SHA-256 over the UTF-8 string).
UPDATE "appointments"
SET "idempotency_key_hash" = encode(sha256(convert_to("idempotency_key"::text, 'UTF8')), 'hex')
WHERE "idempotency_key" IS NOT NULL AND "idempotency_key_hash" IS NULL;
