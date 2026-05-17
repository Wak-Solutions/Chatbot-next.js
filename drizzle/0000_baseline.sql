CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'agent' NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_login" timestamp with time zone,
	"webauthn_credential" jsonb,
	"terms_accepted_at" timestamp with time zone,
	"company_id" integer DEFAULT 1,
	"phone" text,
	CONSTRAINT "agents_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "blocked_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"time" text NOT NULL,
	"company_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_notified" (
	"key" text PRIMARY KEY NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatbot_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"system_prompt" text,
	"structured_config" jsonb,
	"override_active" boolean DEFAULT true,
	"demo_conversation" jsonb,
	"menu_config" jsonb DEFAULT '[]'::jsonb,
	"company_id" integer,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"brand_name" text,
	"app_url" text,
	"webhook_secret" text,
	"whatsapp_token" text,
	"whatsapp_phone_number_id" text,
	"whatsapp_app_secret" text,
	"industry" text,
	"country" text,
	"website" text,
	"team_size" text,
	"onboarding_step" integer DEFAULT 1,
	"onboarding_complete" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"work_hours" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "companies_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_companies" (
	"contact_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text,
	CONSTRAINT "contact_companies_contact_id_company_id_pk" PRIMARY KEY("contact_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"name" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "contacts_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "demo_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"meeting_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"meeting_link" text,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_phone" text NOT NULL,
	"escalation_reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"assigned_agent_id" integer,
	"company_id" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_phone" text,
	"meeting_link" text,
	"meeting_token" text,
	"token_expires_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"agent_id" integer,
	"company_id" integer DEFAULT 1,
	"customer_email" text,
	"link_sent" boolean DEFAULT false,
	"agreed_time" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_phone" text NOT NULL,
	"direction" text NOT NULL,
	"message_text" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"sender" text NOT NULL,
	"escalation_id" integer,
	"media_type" text,
	"media_url" text,
	"transcription" text,
	"company_id" integer DEFAULT 1,
	"conversation_id" uuid
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text,
	"customer_phone" text,
	"status" text,
	"details" text,
	"company_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "processed_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"subscription" jsonb NOT NULL,
	"company_id" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "raw_inbound_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone_number_id" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"plan" text,
	"status" text,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "survey_answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"response_id" integer,
	"question_id" integer,
	"answer_text" text,
	"answer_rating" integer,
	"answer_yes_no" boolean,
	"created_at" timestamp with time zone DEFAULT now(),
	"company_id" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"survey_id" integer,
	"question_text" text NOT NULL,
	"question_type" text NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"company_id" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"survey_id" integer,
	"token" text NOT NULL,
	"customer_phone" text NOT NULL,
	"agent_id" integer,
	"escalation_id" integer,
	"meeting_id" integer,
	"submitted" boolean DEFAULT false,
	"submitted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"company_id" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "survey_responses_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"company_id" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audio_data" "bytea" NOT NULL,
	"mime_type" text DEFAULT 'audio/ogg' NOT NULL,
	"company_id" integer DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_slots" ADD CONSTRAINT "blocked_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_companies" ADD CONSTRAINT "contact_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD CONSTRAINT "demo_bookings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_response_id_survey_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_question_id_survey_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."survey_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_company" ON "agents" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_slots_company_date_time_key" ON "blocked_slots" USING btree ("company_id","date","time");--> statement-breakpoint
CREATE INDEX "contact_companies_company_idx" ON "contact_companies" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "idx_escalations_company_phone" ON "escalations" USING btree ("company_id","customer_phone");--> statement-breakpoint
CREATE INDEX "idx_escalations_customer_phone" ON "escalations" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "idx_escalations_assigned_agent" ON "escalations" USING btree ("assigned_agent_id");--> statement-breakpoint
CREATE INDEX "idx_meetings_meeting_token" ON "meetings" USING btree ("meeting_token");--> statement-breakpoint
CREATE INDEX "idx_meetings_company_status" ON "meetings" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "idx_meetings_agent_id" ON "meetings" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_meetings_scheduled_at" ON "meetings" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_messages_company_phone" ON "messages" USING btree ("company_id","customer_phone");--> statement-breakpoint
CREATE INDEX "idx_messages_company_created" ON "messages" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_id" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_messages_company_phone_created" ON "messages" USING btree ("company_id","customer_phone","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_messages_escalation_id" ON "messages" USING btree ("escalation_id");--> statement-breakpoint
CREATE INDEX "idx_messages_customer_phone" ON "messages" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "idx_orders_phone_company" ON "orders" USING btree ("customer_phone","company_id");--> statement-breakpoint
CREATE INDEX "password_resets_agent_idx" ON "password_resets" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_agent_idx" ON "push_subscriptions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_company_idx" ON "push_subscriptions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "session" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_survey_answers_response_id" ON "survey_answers" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "idx_survey_responses_survey_company" ON "survey_responses" USING btree ("survey_id","company_id");--> statement-breakpoint
CREATE INDEX "idx_survey_responses_phone_company" ON "survey_responses" USING btree ("customer_phone","company_id");--> statement-breakpoint
CREATE INDEX "idx_survey_responses_agent_id" ON "survey_responses" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_survey_per_company" ON "surveys" USING btree ("company_id") WHERE is_active = true;