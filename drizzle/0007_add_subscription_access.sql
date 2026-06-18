ALTER TABLE "companies" ADD COLUMN "subscription_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "unlimited_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Platform owner (WAK Solutions, company 1 — receives all demo bookings)
-- never expires.
UPDATE "companies" SET "unlimited_access" = true WHERE "id" = 1;
