/**
 * Typed environment-variable loaders for the Next.js app and the Node worker.
 *
 * Two separate schemas because the two services need different secrets:
 *   - App: SESSION_SECRET, Brevo, VAPID, WebAuthn (RP_ID/RP_ORIGIN), APP_URL …
 *   - Worker: VERIFY_TOKEN (Meta webhook GET handshake), DASHBOARD_URL …
 *
 * Both share the base set: DATABASE_URL, OPENAI_*, NODE_ENV, LOG_LEVEL.
 *
 * Per-tenant secrets (whatsapp_token, whatsapp_app_secret, webhook_secret,
 * app_url) live in the companies table — not here.
 *
 * Parsing is lazy: nothing reads process.env at import time. Call
 * loadAppEnv() / loadWorkerEnv() exactly once at the service entry point
 * (or on first use) and pass the result down.
 */

import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'production', 'test']);
const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  // The chatbot's default model. The app's chatbot-config AI editor also
  // honors this when no override is passed.
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  NODE_ENV: nodeEnvSchema.default('development'),
  LOG_LEVEL: logLevelSchema.default('info'),
});

export const appEnvSchema = baseEnvSchema.extend({
  // 64-byte hex is the recommended length, but accept any sufficiently long
  // secret. Refusing to start on a weak SESSION_SECRET matches prior behavior.
  SESSION_SECRET: z.string().min(32),

  // Railway-injected. Falls back through APP_URL → RAILWAY_PUBLIC_URL →
  // RAILWAY_PUBLIC_DOMAIN at the call site; all three are optional here.
  APP_URL: z.string().url().optional(),
  RAILWAY_PUBLIC_URL: z.string().url().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().min(1).optional(),

  // Server binding. Railway sets PORT.
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),

  // Brevo (transactional email).
  BREVO_API_KEY: z.string().min(1).optional(),
  BREVO_FROM_EMAIL: z.string().email().optional(),
  BREVO_FROM_NAME: z.string().min(1).optional(),
  MANAGER_EMAIL: z.string().email().optional(),

  // Daily.co (video rooms for meetings).
  DAILY_API_KEY: z.string().min(1).optional(),

  // Web Push / VAPID.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_EMAIL: z.string().min(1).optional(),

  // WebAuthn (biometric login). Required together; checked at the call site
  // when the WebAuthn routes are actually wired.
  RP_ID: z.string().min(1).optional(),
  RP_ORIGIN: z.string().url().optional(),

  // First-deploy admin seed. No effect once any row exists in agents.
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  DASHBOARD_PASSWORD: z.string().min(1).optional(),
});

export const workerEnvSchema = baseEnvSchema.extend({
  // Meta webhook GET handshake token. Refuse to start without it; per the
  // legacy contract this is a single global value (Meta's webhook
  // registration is per-App, not per-phone-number).
  VERIFY_TOKEN: z.string().min(32),

  // Base URL for customer-facing booking links when companies.app_url is
  // unset for a tenant.
  DASHBOARD_URL: z.string().url().optional(),

  // Worker still needs a port if it exposes a health endpoint.
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),

  // BullMQ Redis connection (Phase 2). Refuse to start without it — the
  // worker's queue/dispatch path depends on Redis being reachable.
  REDIS_URL: z.string().url(),
});

export type AppEnv = z.infer<typeof appEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadAppEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return appEnvSchema.parse(source);
}

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return workerEnvSchema.parse(source);
}

// Memoised accessor matching the Phase 2 spec's `getWorkerEnv()` import.
// Caches the parsed result so repeated calls (from connection.ts,
// queue/queues.ts, etc.) don't re-run Zod validation on every use.
let _workerEnv: WorkerEnv | null = null;
export function getWorkerEnv(): WorkerEnv {
  if (!_workerEnv) _workerEnv = loadWorkerEnv();
  return _workerEnv;
}
