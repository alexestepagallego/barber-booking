ALTER TABLE "appointments" DROP CONSTRAINT "appointments_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" DROP COLUMN "idempotency_key";