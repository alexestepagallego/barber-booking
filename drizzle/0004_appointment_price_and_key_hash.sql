ALTER TABLE "appointments" ADD COLUMN "idempotency_key_hash" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_idempotency_key_hash_unique" UNIQUE("idempotency_key_hash");