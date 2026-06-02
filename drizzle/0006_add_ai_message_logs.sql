CREATE TABLE IF NOT EXISTS "ai_message_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"customer_phone" text,
	"conversation_id" text,
	"user_message" text,
	"ai_response" text,
	"status" text NOT NULL,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
