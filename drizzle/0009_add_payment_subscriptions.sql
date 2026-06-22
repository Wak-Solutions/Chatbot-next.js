CREATE TABLE IF NOT EXISTS "payment_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"provider" text DEFAULT 'tap' NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"provider_customer_id" text,
	"provider_card_id" text,
	"provider_agreement_id" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"next_charge_at" timestamp with time zone,
	"last_charge_id" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "payment_subscriptions" ADD CONSTRAINT "payment_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_subscriptions_company_idx" ON "payment_subscriptions" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_subscriptions_next_charge_idx" ON "payment_subscriptions" ("next_charge_at");
