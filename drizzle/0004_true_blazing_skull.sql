CREATE TABLE "conversation_ai_state" (
	"customer_phone" text NOT NULL,
	"company_id" integer NOT NULL,
	"ai_paused" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by_agent_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_ai_state_customer_phone_company_id_pk" PRIMARY KEY("customer_phone","company_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_ai_state" ADD CONSTRAINT "conversation_ai_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_ai_state" ADD CONSTRAINT "conversation_ai_state_paused_by_agent_id_agents_id_fk" FOREIGN KEY ("paused_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;