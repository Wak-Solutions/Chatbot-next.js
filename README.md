# Agents

WAK Solutions — WhatsApp customer-engagement platform. Next.js dashboard + Node worker + Postgres.

## Architecture

Two long-running services share one Postgres database:

```
                            ┌────────────────────────┐
   browsers ───────────────▶│ dashboard-next         │
   (agents)                 │  Next.js 15 App Router │
                            │  app/  — pages + api   │
                            │  lib/  — server libs   │
                            │  components/ hooks/    │
                            └─────────┬──────────────┘
                                      │
                                      │ pg pool
                                      ▼
                            ┌────────────────────────┐
   Meta WhatsApp webhook ──▶│ worker                 │
                            │  Node http (no framework)
                            │  worker/  — entrypoint │
                            │  lib/     — shared libs│
                            └─────────┬──────────────┘
                                      │
                                      │ pg pool
                                      ▼
                            ┌────────────────────────┐
                            │ Postgres (Supabase)    │
                            │  Drizzle ORM           │
                            │  drizzle/0000_*.sql    │
                            └────────────────────────┘
```

**dashboard-next** serves the agent UI and the agent-facing JSON API. Next.js App Router (Server Components for layouts, Client Components for forms / pages with state).

**worker** receives Meta webhooks, runs the LLM orchestration (OpenAI + tool calls), and fires the meeting-reminder cron. Plain `node:http` server — no Express, no Next.js. The webhook receive path enqueues bot turns through a Semaphore (default `max = 8`) so a burst of webhooks doesn't fan out into N simultaneous OpenAI calls.

**External integrations:** Meta WhatsApp Cloud API (inbound webhooks + outbound sends), OpenAI (chat completions + Whisper), Daily.co (meeting rooms), Brevo (transactional email), VAPID Web Push (browser notifications).

## Local development

Two terminals — matches the production topology (two Railway services). Adding `concurrently` was rejected on purpose; running them separately keeps the two log streams legible and lets you restart one without disturbing the other.

```bash
# Terminal 1 — dashboard
npm install
npm run dev:app
# → http://localhost:3000

# Terminal 2 — worker
npm run dev:worker
# → http://localhost:3001 (configurable via PORT env var)
```

### Required env vars (local)

Copy `.env.example` to `.env` and fill in. Both processes read `.env` via `dotenv` (worker scripts) and Next.js auto-loading (app).

Minimum to run end-to-end locally:

```
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
SESSION_SECRET=<32+ char random string>
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
VERIFY_TOKEN=<32+ char Meta-webhook token>
DASHBOARD_URL=http://localhost:3000
APP_URL=http://localhost:3000
NODE_ENV=development
LOG_LEVEL=info
```

See [.env.example](.env.example) for the complete list (Brevo, VAPID, WebAuthn RP_ID/RP_ORIGIN, Daily.co, etc.).

## Database

Source of truth: [lib/db/schema.ts](lib/db/schema.ts). Migrations are file-based and journaled via Drizzle Kit.

### Workflow

1. Edit `lib/db/schema.ts`.
2. `npx drizzle-kit generate` — emits `drizzle/NNNN_<name>.sql` and updates `drizzle/meta/_journal.json` + `drizzle/meta/NNNN_snapshot.json`.
3. Commit all three files.
4. CI runs `npm run check` and `npm run check:no-inline-ddl`.
5. Deploy. Railway's `preDeployCommand` on the dashboard service runs `npx tsx scripts/migrate.ts` before traffic flips.

### Which service runs migrations

- **dashboard-next** — yes, via [railway.app.json](railway.app.json) preDeploy hook.
- **worker** — no. Two writers racing the same journal would corrupt `drizzle.__drizzle_migrations`.
- **local** — `npm run db:migrate` (manual).

### Baseline

[drizzle/0000_baseline.sql](drizzle/0000_baseline.sql) is the schema snapshot reconstructed from the legacy inline DDL. Production already has these tables — [scripts/mark-baseline.ts](scripts/mark-baseline.ts) records the baseline's hash as applied so subsequent `migrate` runs skip it. Run mark-baseline.ts **once**, manually, the first time PR 14+ deploys to production. See [docs/cutover-runbook.md](docs/cutover-runbook.md).

### Don't use `drizzle-kit push` in production

`db:push` exists for ad-hoc local development only. Never run it against production — `push` bypasses the journal and would corrupt baseline tracking. Always go through `generate` → review → commit → deploy.

### Policy fence

[scripts/check-no-inline-ddl.ts](scripts/check-no-inline-ddl.ts) scans `lib/`, `app/`, `worker/`, `scripts/` for inline `CREATE TABLE` / `ALTER TABLE … ADD COLUMN`. Fails CI on hit. Exclusions: `scripts/mark-baseline.ts` (allowed bootstrap), `scripts/check-no-inline-ddl.ts` (contains the regex).

```bash
npm run check:no-inline-ddl
```

## Production deployment (Railway)

Two services, both reading from the same Postgres `DATABASE_URL`.

### dashboard-next

- Config: [railway.app.json](railway.app.json)
- Build: `npm ci && npm run build:app`
- Predeploy: `npx tsx scripts/migrate.ts` (runs BEFORE traffic flips; failure blocks the deploy)
- Start: `npm run start:app` → `next start`
- Healthcheck: `/api/health` (timeout 30s)

### worker

- Config: [railway.worker.json](railway.worker.json)
- Build: `npm ci && npm run build:worker` (tsup → `dist/worker.cjs`)
- Start: `npm run start:worker` → `node dist/worker.cjs`
- Healthcheck: `/health` (timeout 30s)
- No predeploy migration hook (dashboard is sole writer)

### Env vars

See [.env.example](.env.example). Critical:

| Var | Dashboard | Worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✓ | ✓ | Same value. |
| `SESSION_SECRET` | ✓ | — | Worker doesn't read sessions. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | ✓ | ✓ | Same value. |
| `VERIFY_TOKEN` | — | ✓ | Meta webhook handshake. |
| `RP_ID`, `RP_ORIGIN` | ✓ | — | WebAuthn. Must match production domain. |
| `APP_URL` | ✓ | ✓ | Booking URLs + cron-derived links. |
| `DASHBOARD_URL` | — | ✓ | Worker uses for booking-link construction. |
| `VAPID_*` | ✓ | — | Push notifications. |
| `BREVO_*`, `MANAGER_EMAIL`, `DAILY_API_KEY` | ✓ | — | Email + Daily.co. |
| `CRON_ENABLED` | — | ✓ | Set to `1` to enable meeting-reminder cron. Default OFF. |

## Operational notes

- **No queue.** Webhook receive enqueues into an in-process Semaphore; if the worker process dies mid-turn, the message_id is already claimed in `processed_messages` and the customer will retry via WhatsApp.
- **No retries from our side.** Meta retries upstream if we return non-200; we return 200 on every recoverable input issue (malformed body, missing phone_number_id, unknown phone_number_id, DB error during company resolve) per the Phase 1 §10 contract. 403 only on positive HMAC signature failure.
- **Idempotency.** `processed_messages.ON CONFLICT DO NOTHING` on the message_id. Duplicate Meta deliveries no-op.
- **Concurrency cap.** Webhook receive runs each bot turn through `worker/concurrency.Semaphore` (`max = 8`). Adjustable; refine after load testing.
- **Conversation_id race protection.** Both inbound (worker) and outbound (`/api/send`) acquire `pg_advisory_xact_lock(lockKey('convo:<companyId>:<phone>'))` before resolving/inserting the conversation_id. SHA-256-based key serializes cross-process.
- **Meeting reminders.** Cron in worker, every 60s, atomic `UPDATE meetings SET link_sent = TRUE WHERE id = $1 AND link_sent = FALSE RETURNING id` claim. Single writer.
- **Monitoring.** Pino structured logs to stdout. Railway captures them. See [docs/cutover-runbook.md](docs/cutover-runbook.md) for the post-cutover metrics table.

## Manual steps for fresh deploy

1. **Provision Postgres** (Supabase or equivalent). Note the `DATABASE_URL`.
2. **Run [scripts/mark-baseline.ts](scripts/mark-baseline.ts) ONCE** against production. Records the baseline migration as applied without running its DDL (production already has the tables).
3. **Set env vars** on both Railway services per the table above.
4. **Generate VAPID keys** if not already set: `npx web-push generate-vapid-keys`. Set both keys on dashboard-next.
5. **Configure WebAuthn**: `RP_ID` = production domain without scheme (e.g. `wak-agent.up.railway.app`); `RP_ORIGIN` = `https://<RP_ID>`. Must match the domain users hit in the browser — mismatch causes biometric login to fail with `WEBAUTHN_RP_MISMATCH`.
6. **Point Meta App Console webhook** at `https://<worker-url>/webhook`. Use the same `VERIFY_TOKEN` value Meta sends in the GET handshake.
7. **Subscribe to push** in the dashboard UI on each agent's device (one-time per device).

Full deploy sequence (with rollback paths) lives in [docs/cutover-runbook.md](docs/cutover-runbook.md). The runbook is the canonical operational reference — this README is just the orientation.

## Repo layout

```
app/                  Next.js App Router
  (public)/             Public route group (landing, login, register, terms, etc.)
  (auth)/               Authenticated route group (dashboard, inbox, settings, etc.)
  api/                  API routes (Route Handlers)
components/           shadcn UI + custom components
hooks/                React Query hooks
lib/                  Shared libraries (auth, db, llm, messaging, meetings, …)
  contracts/            API contract + types (shared by dashboard and worker)
  db/                   Drizzle schema (source of truth) + pool client
worker/               Worker service (http + cron + orchestrator)
  http/                 webhook + health
  orchestrator/         getReply pipeline + buildMessages + runOpenAITurn + …
  tasks/                processText, processAudio
  menu/                 menuConfig navigator
scripts/              migrate, mark-baseline, check-no-inline-ddl
drizzle/              Generated migration SQL + journal
docs/                 cutover-runbook, migration-divergences
locales/              en + ar translations
public/               static assets (favicon, sw.js, etc.)
```

## Audit trail

[docs/migration-divergences.md](docs/migration-divergences.md) lists every intentional behavior change vs the legacy Express + Python stack. Three sections: (1) cutover-monitoring items (operator should watch for these), (2) wire-shape decisions, (3) operational / structural.

## License

MIT.
