/**
 * lib/db/schema.ts — Drizzle schema for the migrated stack.
 *
 * 25 tables in two groups:
 *   1. Hand-ported from CREATE TABLE / ALTER TABLE blocks in server/ (17).
 *   2. Pre-existing in production from earlier migrations whose CREATE
 *      statements are no longer in the codebase (8). Tagged with
 *      `// HAND-PORT: reconcile against introspect` — columns reverse-
 *      engineered from INSERT / SELECT / UPDATE references in code.
 *
 * Expected drift from prod (reconcile during cutover):
 *
 *   • messages.conversation_id is declared uuid + nullable here. The legacy
 *     shared/schema.ts had it as text + notNull. The runtime ALTER adds
 *     it as UUID with no NOT NULL — prod is nullable. The text → uuid
 *     declaration delta is intentional; do NOT let drizzle-kit emit an
 *     ALTER COLUMN TYPE migration against prod. Type drift must be
 *     resolved manually outside Drizzle if introspect surfaces it.
 *
 *   • Nine company_id columns carry DEFAULT 1 (agents, voice_notes, messages,
 *     escalations, push_subscriptions, surveys, survey_questions,
 *     survey_responses, survey_answers). Multi-tenant retrofit: tenant id 1
 *     (WAK Solutions) is the implicit owner of legacy rows. Not a permanent
 *     default. Future tables MUST NOT add this.
 *
 *   • agents.email and companies.email are nullable + UNIQUE. The original
 *     CREATE emits NOT NULL but a later ALTER drops it. Postgres default
 *     UNIQUE semantics: multiple NULLs are allowed. NULLS NOT DISTINCT is
 *     intentionally NOT used.
 *
 *   • Pre-existing tables (companies, meetings, chatbot_config, orders,
 *     blocked_slots, subscriptions, processed_messages, raw_inbound_messages):
 *     columns inferred from references. Likely gaps in column types and
 *     untouched columns. Reconcile when scripts/introspect.sh is run.
 *
 *   • Known column drift between prod and this schema (audited 2026-05-18):
 *     The following columns exist in production but are NOT modelled here.
 *     They are legacy fields the new code does not read or write — kept
 *     for historical data and (in one case) for a Supabase view dependency.
 *     Running `drizzle-kit generate` would propose DROP statements for
 *     all of them. Do not apply such a migration without manual review.
 *
 *       blocked_slots.blocked_at
 *       chatbot_config.business_name, .tone, .greeting, .faq,
 *                     .escalation_rules        (superseded by structured_config)
 *       companies.whatsapp_waba_id             (read by companies_decrypted view)
 *       subscriptions.trial_starts_at, .next_billing_date
 *       survey_answers.answer_choice           (superseded by answer_text/answer_rating)
 *       survey_questions.options               (superseded by normalized question rows)
 *
 *   • Intentionally unmodelled views (audited 2026-05-18):
 *     The following Postgres views exist in production and are NOT modelled
 *     in Drizzle. Application code reads from them but never writes through
 *     Drizzle. Running `drizzle-kit generate` would propose DROP VIEW
 *     statements. Do not apply such a migration without manual review.
 *
 *       companies_decrypted   — decrypts encrypted whatsapp_* columns
 *       subscription_status   — computes remaining_trial_days from companies.created_at
 *       calendar_events       — unified meetings + demo_bookings feed for availability
 *
 * JSONB shapes (declared as plain jsonb — typed wrappers arrive later):
 *
 *   agents.webauthn_credential       Legacy single-credential blob or null.
 *                                    Active store is the webauthn_credentials
 *                                    table.
 *
 *   push_subscriptions.subscription  Web Push subscription:
 *                                    { endpoint, keys: { p256dh, auth } }
 *
 *   chatbot_config.structured_config { businessName, industry, tone,
 *                                      customTone?, greeting, closingMessage,
 *                                      servicesText?, questions[], faq[],
 *                                      escalationRules[], menuConfig[] }
 *
 *   chatbot_config.demo_conversation Array<{ role: 'bot' | 'user';
 *                                            text: string }> | null
 *
 *   chatbot_config.menu_config       Array<{ id, label,
 *                                            subItems: Array<string |
 *                                                            { id, label,
 *                                                              subItems?: string[] }> }>
 *                                    Max depth 3 enforced in chatbot-config.routes.ts.
 *
 *   companies.work_hours             Per-tenant weekly schedule object —
 *                                    exact shape consumed by
 *                                    server/routes/settings.routes.ts.
 *
 *   raw_inbound_messages.payload     Full verified Meta webhook payload as
 *                                    received in POST /webhook.
 */

import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Drizzle 0.39 has no built-in bytea. voice_notes.audio_data uses this.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// ────────────────────────────────────────────────────────────────────────────
// TENANCY: companies, subscriptions, agents, config
// ────────────────────────────────────────────────────────────────────────────

// HAND-PORT: reconcile against introspect.
// Reverse-engineered from INSERT INTO companies at register.routes.ts:116,
// the column-add loop at register.routes.ts:48-58, every SELECT-list grep,
// and the work_hours / created_at ALTERs.
export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  name: text('name'),
  // Originally NOT NULL UNIQUE. ALTER ... DROP NOT NULL at register.routes.ts:67
  // makes it nullable in prod. Multiple NULLs allowed under UNIQUE.
  email: text('email').unique(),
  phone: text('phone'),
  brand_name: text('brand_name'),
  app_url: text('app_url'),
  webhook_secret: text('webhook_secret'),
  whatsapp_token: text('whatsapp_token'),
  whatsapp_phone_number_id: text('whatsapp_phone_number_id'),
  whatsapp_app_secret: text('whatsapp_app_secret'),
  industry: text('industry'),
  country: text('country'),
  website: text('website'),
  team_size: text('team_size'),
  onboarding_step: integer('onboarding_step').default(1),
  onboarding_complete: boolean('onboarding_complete').default(false),
  is_active: boolean('is_active').default(true),
  // JSONB shape documented at top of file.
  work_hours: jsonb('work_hours'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// HAND-PORT: reconcile against introspect.
// Only INSERTed at register.routes.ts:125. Trial gate uses
// companies.created_at + config.trial_days, not this table.
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  company_id: integer('company_id').references(() => companies.id),
  plan: text('plan'),
  status: text('status'),
  trial_ends_at: timestamp('trial_ends_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// CREATE at server/agents.ts:11. ALTERs add: terms_accepted_at,
// company_id (FK→companies), phone. ALTER ... DROP NOT NULL on email.
export const agents = pgTable('agents', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  // UNIQUE preserved; NOT NULL dropped at runtime — see header comment.
  email: text('email').unique(),
  password_hash: text('password_hash').notNull(),
  role: text('role').notNull().default('agent'),
  is_active: boolean('is_active').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  last_login: timestamp('last_login', { withTimezone: true }),
  // Vestigial single-credential blob. Active store is webauthn_credentials.
  webauthn_credential: jsonb('webauthn_credential'),
  terms_accepted_at: timestamp('terms_accepted_at', { withTimezone: true }),
  // DEFAULT 1: multi-tenant retrofit; tenant id 1 = WAK Solutions.
  // Not a permanent default — see header comment.
  company_id: integer('company_id').default(1).references(() => companies.id),
  phone: text('phone'),
}, (table) => [
  index('idx_agents_company').on(table.company_id),
]);

// Global key/value store. Only entry today: trial_days.
export const config = pgTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ────────────────────────────────────────────────────────────────────────────
// SESSION & AUTH ARTIFACTS
// ────────────────────────────────────────────────────────────────────────────

// CREATE at server/index.ts:158. Shape required by connect-pg-simple.
// Identifier "session" is quoted (lowercase, but reserved word in some
// dialects). Drizzle's pgTable name argument preserves it verbatim.
export const session = pgTable('session', {
  sid: varchar('sid').primaryKey(),
  sess: json('sess').notNull(),
  expire: timestamp('expire', { precision: 6 }).notNull(),
}, (table) => [
  index('IDX_session_expire').on(table.expire),
]);

// CREATE at server/routes/auth.routes.ts:50.
export const webauthn_credentials = pgTable('webauthn_credentials', {
  id: serial('id').primaryKey(),
  agent_id: integer('agent_id').notNull().references(() => agents.id),
  credential_id: text('credential_id').notNull().unique(),
  public_key: text('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// CREATE at server/routes/auth.routes.ts:64. Stores only SHA-256 of the
// reset token — never the raw token. Single-use, short-lived.
export const password_resets = pgTable('password_resets', {
  id: serial('id').primaryKey(),
  agent_id: integer('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  token_hash: text('token_hash').notNull().unique(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at: timestamp('used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('password_resets_agent_idx').on(table.agent_id),
]);

// ────────────────────────────────────────────────────────────────────────────
// CONVERSATIONS: messages, escalations, voice_notes
// ────────────────────────────────────────────────────────────────────────────

// Defined in shared/schema.ts (Drizzle) + runtime ALTERs for media_*, company_id,
// conversation_id. Note: messages.created_at is plain `timestamp` (no TZ) to
// match shared/schema.ts and the prod state.
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  customer_phone: text('customer_phone').notNull(),
  // 'inbound' | 'outbound'
  direction: text('direction').notNull(),
  message_text: text('message_text').notNull(),
  created_at: timestamp('created_at').defaultNow(),
  // 'customer' | 'ai' | 'agent'
  sender: text('sender').notNull(),
  escalation_id: integer('escalation_id').references((): any => escalations.id),
  media_type: text('media_type'),
  media_url: text('media_url'),
  transcription: text('transcription'),
  // DEFAULT 1: multi-tenant retrofit; tenant id 1 = WAK Solutions.
  company_id: integer('company_id').default(1),
  // INTENTIONAL DIVERGENCE: declared uuid + nullable here. shared/schema.ts
  // had it as text + notNull. Runtime ALTER adds it as UUID without NOT NULL.
  // Do NOT let drizzle-kit emit an ALTER COLUMN TYPE against prod — see
  // header comment.
  conversation_id: uuid('conversation_id'),
}, (table) => [
  index('idx_messages_company_phone').on(table.company_id, table.customer_phone),
  index('idx_messages_company_created').on(table.company_id, table.created_at.desc()),
  index('idx_messages_conversation_id').on(table.conversation_id),
  index('idx_messages_company_phone_created').on(
    table.company_id,
    table.customer_phone,
    table.created_at.desc(),
  ),
  index('idx_messages_escalation_id').on(table.escalation_id),
  index('idx_messages_customer_phone').on(table.customer_phone),
]);

// Defined in shared/schema.ts (Drizzle). fix_schema.sql:27 dropped the
// customer_phone PK and added id SERIAL PK; agents.ts:34 added the
// assigned_agent_id FK. created_at is plain `timestamp` (no TZ) per
// shared/schema.ts.
export const escalations = pgTable('escalations', {
  id: serial('id').primaryKey(),
  customer_phone: text('customer_phone').notNull(),
  escalation_reason: text('escalation_reason'),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').defaultNow(),
  assigned_agent_id: integer('assigned_agent_id').references(() => agents.id),
  // DEFAULT 1: multi-tenant retrofit.
  company_id: integer('company_id').default(1),
}, (table) => [
  index('idx_escalations_company_phone').on(table.company_id, table.customer_phone),
  index('idx_escalations_customer_phone').on(table.customer_phone),
  index('idx_escalations_assigned_agent').on(table.assigned_agent_id),
]);

// CREATE at server/index.ts:178. ALTER adds company_id default 1.
// id is UUID with gen_random_uuid() default (Postgres 13+ built-in).
export const voice_notes = pgTable('voice_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  audio_data: bytea('audio_data').notNull(),
  mime_type: text('mime_type').notNull().default('audio/ogg'),
  // DEFAULT 1: multi-tenant retrofit.
  company_id: integer('company_id').default(1),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// HAND-PORT: reconcile against introspect.
// Only INSERT/ON CONFLICT at Chatbot/_db_inbox.py:23. Idempotency table —
// stores Meta message_id to dedupe webhook retries.
export const processed_messages = pgTable('processed_messages', {
  message_id: text('message_id').primaryKey(),
  // Inferred — not directly referenced. Useful for a sweeper job.
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// HAND-PORT: reconcile against introspect.
// Only INSERTed at Chatbot/_db_inbox.py:50. Stores the verified raw Meta
// payload so a crash mid-processing leaves a replayable record.
export const raw_inbound_messages = pgTable('raw_inbound_messages', {
  id: serial('id').primaryKey(),
  phone_number_id: text('phone_number_id'),
  payload: jsonb('payload'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// PUSH NOTIFICATIONS: push_subscriptions, chat_notified
// ────────────────────────────────────────────────────────────────────────────

// CREATE at server/index.ts:241. UNIQUE on endpoint.
export const push_subscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  agent_id: integer('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  // JSONB shape documented at top of file.
  subscription: jsonb('subscription').notNull(),
  // DEFAULT 1: multi-tenant retrofit.
  company_id: integer('company_id').notNull().default(1),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('push_subscriptions_agent_idx').on(table.agent_id),
  index('push_subscriptions_company_idx').on(table.company_id),
]);

// CREATE at server/index.ts:267. Dedup set for "New Chat" push notifications.
// 24h TTL enforced by sweep at startup.
export const chat_notified = pgTable('chat_notified', {
  key: text('key').primaryKey(),
  notified_at: timestamp('notified_at', { withTimezone: true }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// MEETINGS: meetings, demo_bookings, blocked_slots
// ────────────────────────────────────────────────────────────────────────────

// HAND-PORT: reconcile against introspect.
// Columns inferred from every INSERT/UPDATE/SELECT in routes/meetings.routes.ts,
// lib/meeting-reminders.ts, and Chatbot/_db_meetings.py. agreed_time confirmed
// TEXT (not TIMESTAMP) — Python signature is `str`, Node SELECT casts ::text.
// meeting_token declared text; demo_bookings.meeting_token is explicitly uuid
// in its CREATE — type may diverge in prod, reconcile during introspect.
export const meetings = pgTable('meetings', {
  id: serial('id').primaryKey(),
  customer_phone: text('customer_phone'),
  meeting_link: text('meeting_link'),
  meeting_token: text('meeting_token'),
  token_expires_at: timestamp('token_expires_at', { withTimezone: true }),
  scheduled_at: timestamp('scheduled_at', { withTimezone: true }),
  // 'pending' | 'in_progress' | 'completed'
  status: text('status'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  agent_id: integer('agent_id').references(() => agents.id),
  // DEFAULT 1: multi-tenant retrofit.
  company_id: integer('company_id').default(1),
  customer_email: text('customer_email'),
  link_sent: boolean('link_sent').default(false),
  agreed_time: text('agreed_time'),
}, (table) => [
  index('idx_meetings_meeting_token').on(table.meeting_token),
  index('idx_meetings_company_status').on(table.company_id, table.status),
  index('idx_meetings_agent_id').on(table.agent_id),
  index('idx_meetings_scheduled_at').on(table.scheduled_at),
]);

// CREATE at server/routes/meetings.routes.ts:35. Global lead funnel —
// intentionally NO company_id (all rows belong to WAK Solutions).
export const demo_bookings = pgTable('demo_bookings', {
  id: serial('id').primaryKey(),
  agent_id: integer('agent_id').references(() => agents.id),
  customer_name: text('customer_name').notNull(),
  customer_email: text('customer_email').notNull(),
  customer_phone: text('customer_phone'),
  meeting_token: uuid('meeting_token').notNull().defaultRandom(),
  meeting_link: text('meeting_link'),
  scheduled_at: timestamp('scheduled_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// HAND-PORT: reconcile against introspect.
// Only ALTERs in code (meetings.routes.ts:62-75). Columns inferred from
// SELECT/INSERT — date is `date`, time is plain `text` (not cast in SELECT).
// Unique constraint (company_id, date, time) replaces an older
// (date, time) constraint.
export const blocked_slots = pgTable('blocked_slots', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  time: text('time').notNull(),
  company_id: integer('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('blocked_slots_company_date_time_key').on(table.company_id, table.date, table.time),
]);

// ────────────────────────────────────────────────────────────────────────────
// CHATBOT CONFIG, ORDERS
// ────────────────────────────────────────────────────────────────────────────

// HAND-PORT: reconcile against introspect.
// Columns inferred from INSERT/UPDATE/SELECT in chatbot-config.routes.ts.
// ALTERs at chatbot-config.routes.ts:142-147 add structured_config,
// override_active, demo_conversation, menu_config.
export const chatbot_config = pgTable('chatbot_config', {
  id: serial('id').primaryKey(),
  system_prompt: text('system_prompt'),
  // JSONB shape documented at top of file.
  structured_config: jsonb('structured_config'),
  override_active: boolean('override_active').default(true),
  // JSONB shape documented at top of file.
  demo_conversation: jsonb('demo_conversation'),
  // JSONB shape documented at top of file.
  menu_config: jsonb('menu_config').default(sql`'[]'::jsonb`),
  company_id: integer('company_id'),
  updated_at: timestamp('updated_at', { withTimezone: true }),
});

// HAND-PORT: reconcile against introspect.
// Read-only from Chatbot/_db_orders.py. Columns: order_number, status,
// details, created_at, company_id. customer_phone inferred from
// idx_orders_phone_company at routes.ts:74.
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  order_number: text('order_number'),
  customer_phone: text('customer_phone'),
  status: text('status'),
  details: text('details'),
  company_id: integer('company_id'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_orders_phone_company').on(table.customer_phone, table.company_id),
]);

// ────────────────────────────────────────────────────────────────────────────
// SURVEYS: surveys, survey_questions, survey_responses, survey_answers
// ────────────────────────────────────────────────────────────────────────────

// CREATE at server/surveys.ts:14. company_id NOT NULL DEFAULT 1 added via
// ALTER. Partial unique index ensures one active survey per company.
export const surveys = pgTable('surveys', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  is_default: boolean('is_default').default(false),
  is_active: boolean('is_active').default(false),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  // DEFAULT 1: multi-tenant retrofit.
  company_id: integer('company_id').notNull().default(1),
}, (table) => [
  // Partial unique: each tenant may have exactly one active survey.
  // Replaces the older global one_active_survey which is explicitly
  // DROP INDEXed at runtime — see server/routes.ts:82.
  uniqueIndex('one_active_survey_per_company')
    .on(table.company_id)
    .where(sql`is_active = true`),
]);

// CREATE at server/surveys.ts:23.
export const survey_questions = pgTable('survey_questions', {
  id: serial('id').primaryKey(),
  survey_id: integer('survey_id').references(() => surveys.id, { onDelete: 'cascade' }),
  question_text: text('question_text').notNull(),
  // 'rating' | 'yesno' | 'text'
  question_type: text('question_type').notNull(),
  order_index: integer('order_index').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  // DEFAULT 1: multi-tenant retrofit.
  company_id: integer('company_id').notNull().default(1),
});

// CREATE at server/surveys.ts:31. FKs added via ALTERs in fix_schema.sql:62-67.
export const survey_responses = pgTable('survey_responses', {
  id: serial('id').primaryKey(),
  survey_id: integer('survey_id').references(() => surveys.id),
  token: text('token').notNull().unique(),
  customer_phone: text('customer_phone').notNull(),
  agent_id: integer('agent_id').references(() => agents.id),
  escalation_id: integer('escalation_id').references(() => escalations.id),
  meeting_id: integer('meeting_id').references(() => meetings.id),
  submitted: boolean('submitted').default(false),
  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  // DEFAULT 1: multi-tenant retrofit.
  company_id: integer('company_id').notNull().default(1),
}, (table) => [
  index('idx_survey_responses_survey_company').on(table.survey_id, table.company_id),
  index('idx_survey_responses_phone_company').on(table.customer_phone, table.company_id),
  index('idx_survey_responses_agent_id').on(table.agent_id),
]);

// CREATE at server/surveys.ts:44. answer_yes_no added via ALTER.
export const survey_answers = pgTable('survey_answers', {
  id: serial('id').primaryKey(),
  response_id: integer('response_id').references(() => survey_responses.id, { onDelete: 'cascade' }),
  question_id: integer('question_id').references(() => survey_questions.id),
  answer_text: text('answer_text'),
  answer_rating: integer('answer_rating'),
  answer_yes_no: boolean('answer_yes_no'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  // DEFAULT 1: multi-tenant retrofit.
  company_id: integer('company_id').notNull().default(1),
}, (table) => [
  index('idx_survey_answers_response_id').on(table.response_id),
]);

// ────────────────────────────────────────────────────────────────────────────
// CONTACTS: contacts, contact_companies
// ────────────────────────────────────────────────────────────────────────────

// CREATE at server/index.ts:186. The per-company company_id column was
// DROPPED at runtime (contacts-migration.ts:115) and replaced with a global
// UNIQUE (phone_number) plus the contact_companies join table below.
export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  // UNIQUE constraint named contacts_phone_unique by the runtime migration.
  phone_number: text('phone_number').notNull().unique(),
  name: text('name'),
  source: text('source').notNull().default('manual'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('contacts_phone_idx').on(table.phone_number),
]);

// CREATE at server/lib/contacts-migration.ts:22. Composite PK
// (contact_id, company_id) — no surrogate id column.
export const contact_companies = pgTable('contact_companies', {
  contact_id: integer('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  company_id: integer('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  source: text('source').notNull().default('manual'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Per-tenant label for a shared contact.
  name: text('name'),
}, (table) => [
  primaryKey({ columns: [table.contact_id, table.company_id] }),
  index('contact_companies_company_idx').on(table.company_id),
]);
