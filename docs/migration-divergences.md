# Migration divergences

Intentional behavior changes in the Next.js + worker rewrite vs the legacy Express + Python stack.

This file is an audit-at-cutover checklist — every entry is somewhere the new code does NOT preserve old behavior on purpose. Parity ports do not belong here; only deliberate deviations with their rationale.

## How to use this file

Three sections, by category:

1. **Intentional behavior changes — surfaced at cutover.** What an operator should monitor in the 24 hours after each cutover. If you see customer-impacting behavior different from the legacy stack, check here first — the change may be expected.

2. **Wire-shape decisions.** Differences between the plan's labels and what was actually shipped, where the legacy client/wire shape took precedence (PATCH-vs-POST, withAdmin-vs-withAuth on existing admin-only routes, etc.). No customer impact; here so the API contract is auditable.

3. **Operational / structural.** Build flags, tsconfig paths, code organization. No customer impact and no API surface change.

## 1. Intentional behavior changes — surfaced at cutover

Operators should monitor these post-cutover. Each one is a deliberate, documented departure from the legacy stack.

- **PR 7** — `app/api/send/route.ts` — Added `pg_advisory_xact_lock` around the conversation_id SELECT+INSERT (key `convo:<companyId>:<phone>`). Defensive correctness improvement, not behavior preservation. The race is dormant under a single writer but becomes a true cross-process race in PR 13 when the worker also writes conversation_ids. Lock mirrors the inbound pattern in Python's old `memory.py:144`. **Cutover monitoring:** under concurrent agent sends to the same customer, the new code mints one `conversation_id` where legacy would mint two. Affects analytics joins on conversation_id but not the chat flow.

- **PR 8** — `lib/meetings/createToken.ts` — Lock-key derivation switched from Python's `hash((company_id, customer_phone))` to `lockKey('booking-token:<companyId>:<phone>')` via `@/lib/db/locks`. Python's `hash()` is process-local (PYTHONHASHSEED) — two writers would not actually contend on the same key. SHA-256-based key gives cross-process determinism, required once the PR 13 worker calls `issueMeetingToken` directly. **Cutover monitoring:** no visible change until PR 13 — at that point, two concurrent webhook deliveries to the same customer correctly share a single booking token instead of minting two.

- **PR 10** — `app/(public)/login/page.tsx` WebAuthn re-registration UX — On `WEBAUTHN_RP_MISMATCH` from `/api/auth/webauthn/login/verify`, the error message now says "Your biometric login is no longer valid for this domain. Please sign in with your password, then re-register your biometric in Settings." instead of the generic biometric-failed string. Phase 2 plan; the only intentional behavior change in PR 10. **Cutover monitoring:** if every biometric user sees this at once after a cutover, `RP_ID` on dashboard-next is wrong — see the runbook.

- **PR 12** — `worker/tasks/meetingReminder.ts` wraps the `getCompanyBranding(m.company_id)` lookup in try/catch + fallback to `"Our team"`. **Intentional behavior change — corrective, not preservation.** The legacy `server/lib/meeting-reminders.ts:35` calls `getCompanyBranding` without a try/catch — when a tenant has `brand_name` or `app_url` unset, the throw bubbles to the outer tick try/catch and aborts the entire batch's reminders, not just the misconfigured tenant's. One bad row poisons the window for every other meeting. The corrective change scopes the failure to the individual tenant: log a warning, fall through with the generic brand label, send the reminder. **Cutover monitoring:** if a tenant has unset branding, their reminders now say "Our team" instead of failing. Unrelated meetings still get the brand name.

- **PR 13** — Internal HTTP hops eliminated (Phase 2 D-1). Python's `notify_dashboard` (POST `/api/incoming` + POST `/api/human-requested`) and `_resolve_booking_url` (POST `/api/meetings/create-token`) are replaced with direct in-process function calls in `lib/notifications/dashboard.ts` and `worker/orchestrator/resolveBookingUrl.ts`. Observable behavior is identical (same push fan-out, same dedup keys, same booking-token issuance with advisory-lock retry). **Cutover monitoring:** rate of `/api/incoming` 404s after Python is stopped should be zero — Python was the only caller.

- **PR 13** — Prompt cache invalidation hook in `app/api/chatbot-config/route.ts` POST calls `invalidatePromptCache(companyId)` from `lib/llm/prompts/cache.ts`. **Small behavior improvement vs the 60s-bounded legacy.** In the legacy flow, an admin saving a new prompt waited up to 60 seconds for the bot to pick it up (Python `_prompt_cache.py:14` TTL). The dashboard's hook now invalidates same-process — the dashboard's preview render is immediate. The WORKER's separate prompt cache still has 60s TTL freshness (cross-process invalidation isn't free), so a real customer interaction may still hit a stale prompt for up to 60s after the save. Net: dashboard preview is immediate; worker freshness unchanged.

- **PR 13** — Advisory lock keys for both conversation_id allocation (`lib/messaging/memory.saveMessage`) and booking-token resolution (`worker/orchestrator/resolveBookingUrl` → `lib/meetings/createToken.issueMeetingToken`) use `lib/db/locks.lockKey('convo:...')` / `lockKey('booking-token:...')` (SHA-256 → bigint, deterministic). Python's `hash((company_id, customer_phone)) & 0x7FFFFFFFFFFFFFFF` is process-randomised (PYTHONHASHSEED) and would NOT serialize cross-process between dashboard-next, worker, and Python during the cutover overlap. SHA-256-based keys serialize identically across all writers.

## 2. Wire-shape decisions

Plan-vs-legacy differences resolved in favor of the existing dashboard client. No observable API behavior change.

- **PR 8** — `app/api/meetings/[id]/start/route.ts`, `app/api/meetings/[id]/complete/route.ts` — Ported as PATCH (matches dashboard client); plan listed POST. Wire compat over plan label.

- **PR 8** — `/api/meetings/[id]/complete` missing survey trigger. The legacy `server/routes/meetings.routes.ts` complete handler calls `sendSurveyToCustomer(meetingId)` after marking complete. PR 8 skipped this call because `@/lib/surveys` did not exist yet. **RESOLVED IN PR 9** — `@/lib/surveys/service.ts` ships with `sendSurveyToCustomer` and the call site at `app/api/meetings/[id]/complete/route.ts` is restored.

- **PR 8** — `app/api/demo-booking/slots/route.ts` — Endpoint made public per plan; original is `requireAuth`-gated. Slot calendar derived from WAK Solutions's blocked_slots + work hours + booked conflicts; no tenant data leaked. Low risk.

- **PR 8** — `app/api/book/[token]/route.ts` — Daily.co failure-mode contradiction in hard req #6 ("fall back to no meeting_link and email admins anyway" vs "Match server/routes/meetings.routes.ts behavior exactly"). The legacy code does NOT fall back — it propagates the error. Ported the legacy behavior (no fallback). If the fallback is the desired behavior, this needs a code change.

- **PR 9** — `app/api/customers/route.ts`, `app/api/customers/funnel/route.ts`, `app/api/customers/[phone]/journey/route.ts`, `app/api/contacts/route.ts`, `app/api/contacts/[id]/route.ts`, `app/api/contacts/bulk-delete/route.ts`, `app/api/contacts/import/route.ts` — Plan listed `withAuth`; legacy uses `requireAdmin`. Ported as `withAdmin` to avoid silently widening access from admin-only to any authenticated user. Same pattern as PR 8 demo-booking/book. If broader access is intended, swap to `withAuth` per route.

- **PR 9** — `app/api/contacts/[id]/route.ts` — Ported as PATCH (matches dashboard client); plan listed PUT. Wire compat.

- **PR 9** — `app/api/agents/[id]/deactivate/route.ts`, `app/api/agents/[id]/activate/route.ts`, `app/api/agents/[id]/reset-password/route.ts` — Ported as PATCH (matches dashboard client); plan listed POST. Wire compat.

- **PR 9** — `app/api/surveys/[id]/questions/reorder/route.ts` — Ported as PUT (matches dashboard client); plan listed POST. Wire compat.

- **PR 9** — `app/api/settings/change-password/route.ts` — Uses the new `authChangePasswordLimiter` (5/15min, keyed by agentId at the call site via `cp:<agentId>`). Keyed by agentId to match legacy threat model: this defends against a compromised-session brute-force on one agent's current password regardless of IP rotation. The plan's initial suggestion of `authResetLimiter` (IP-keyed) was corrected — IP keying is bypassed by an attacker rotating IPs and over-restricts agents on shared NAT.

- **PR 13** — Deletion of `app/api/incoming`, `app/api/human-requested`, `app/api/meetings/create-token`. Not additive — three files removed from `app/api/`. The CSRF `WEBHOOK_ALLOWLIST` in `lib/auth/csrf.ts` still mentions these paths as defense-in-depth — keeping them on the allowlist costs nothing and means a stray Python deployment wouldn't hit a CSRF wall in addition to a 404.

## 3. Operational / structural

Build flags, tsconfig paths, code organization. No customer impact and no API surface change.

- **PR 9** — `app/api/settings/whatsapp/route.ts` — `invalidateWhatsappCreds(companyId)` call retained after upsert per hard req #7, even though PR 7's `lib/companies/creds.ts` makes it a no-op. Documented so a future cache reintroduction is auto-wired.

- **PR 10** — `tsconfig.json` paths — During PR 10, did NOT remove the `@lib/*`, `@app/*`, `@worker/*` aliases per the plan. Instead, dual-mapped `@/*` to `["./*", "./client/src/*"]` AND kept the explicit aliases. PR 15 cleanup completed the original plan: all `@lib/foo` etc. imports rewritten to `@/lib/foo` via bulk sed, then the redundant alias entries removed. **Closed in PR 15.**

- **PR 10** — `lib/router.ts` — Added a Wouter → Next.js shim instead of rewriting every page's API calls (useLocation, useParams, Link). Pages keep their Wouter-shaped destructures (`const [, setLocation] = useLocation()`); the shim wires them to next/navigation's useRouter/usePathname/useParams + next/link. The shim file remains in PR 15 — page imports point at `@/lib/router`, not the deleted `wouter` package. A future PR can flip imports to canonical `next/*` and delete the shim if desired.

- **PR 10** — `export const dynamic = 'force-dynamic'` added to every page.tsx — Pages are all session-cookie-aware; pre-rendering them as static HTML at build time is wrong (different user state per request). A future cleanup can selectively remove force-dynamic from `/terms`, `/book/[token]`, `/meeting/[token]`, `/survey/[token]`, `/reset-password/[token]` (these don't read the dashboard session).

- **PR 10** — `app/(public)/ProductDemo.tsx` — Plan said "if dead, mark for PR 15 cleanup; if alive, port as `app/(auth)/product-demo/page.tsx`". ProductDemo is ALIVE (imported by LandingPage as a modal), but it's a component, not a page. Ported as `app/(public)/ProductDemo.tsx` (sibling of the landing page) so the relative `./ProductDemo` import in LandingPage still resolves.

- **PR 10** — `app/(auth)/layout.tsx` auth gate — Both `lib/auth/requireAuth.ts` (HTTP path) and `app/(auth)/layout.tsx` (Server Component path) call the same `resolveSession()` helper in `lib/auth/getSession.ts`. The helper does cookie read + sid verify + session lookup + SR-013 60s is_active recheck + trial gate. The two callers differ only in how they react to a non-authorized result (NextResponse vs `redirect('/login')`).

- **PR 11** — `CRON_ONLY=1` flag on the legacy Express service. Operational mode change, NOT a behavior change. Existed so PR 11 could flip the production domain to dashboard-next while Express kept firing the meeting-reminder cron until PR 12 moved it to the worker. **Retired with the rest of the Express service in PR 15.**

- **PR 12** — Meeting-reminder cron moved from the Express service to the new worker service (`worker/cron.ts` + `worker/tasks/meetingReminder.ts`). NO behavior change: the SQL claim pattern, the WhatsApp message body, the 60s tick interval, the 14-16 minute pre-meeting window, and the release-on-fail recovery are identical. Gated by `CRON_ENABLED=1` on the worker (default OFF) so deploys don't auto-activate.

- **PR 12** — `worker/concurrency.ts` Semaphore (`DEFAULT_MAX = 8`). Per Phase 2 D-5. Consumed by the PR 13 webhook receive path to cap concurrent bot turns.

- **PR 14** — `scripts/migrate.ts` + Railway `preDeployCommand` on the dashboard service. Schema changes flow through Drizzle's file-based journal exclusively after PR 14. The worker has NO predeploy hook — two services racing the same journal would corrupt `drizzle.__drizzle_migrations`.

- **PR 14** — `scripts/check-no-inline-ddl.ts` policy fence — fails CI on any inline `CREATE TABLE` or `ALTER TABLE … ADD COLUMN` in `lib/`, `app/`, `worker/`, `scripts/`. The old tree was exempt from this scan; PR 15 deletes the old tree so the exemption is no longer relevant.

- **PR 15** — Old trees deleted: `server/`, `client/`, `shared/`, `Chatbot/`, `Agents/`. Also `tests/` (old Express test suite — none referenced the new tree), `script/build.ts` (replaced by `next build` + `tsup`), `vite.config.ts`, `vitest.config.ts`, `assets/`, `seed.sql`. Pre-deletion moves: `client/src/lib/utils.ts` → `lib/utils.ts`, `client/src/lib/validate-name.ts` → `lib/validate-name.ts`, `shared/routes.ts` inlined into `lib/contracts/routes.ts`, `shared/schema.ts` types ported to `lib/contracts/schema-types.ts`. Bulk find/replace `@lib/foo` → `@/lib/foo` (and `@app/`, `@worker/`) across all new-tree files so the explicit aliases could be removed in favor of the single `@/*` root mapping. tsconfig.json paths reduced to `{ "@/*": ["./*"] }`. Dropped from package.json: passport, passport-local, resend, wouter, vite, @vitejs/plugin-react, memorystore, @anthropic-ai/sdk, express, express-session, connect-pg-simple, helmet, express-rate-limit, nodemailer, ws, supertest, vitest, @vitest/coverage-v8, @tailwindcss/vite, plus their @types counterparts. Dropped scripts: `dev` (old Express), `build` (old Vite+esbuild), `start` (old node dist), `test`, `test:coverage`. No new-tree tests existed at the time of cleanup — vitest re-add is a future PR if the user wants test coverage.

- **PR 15** — `Agents/` submodule directory removed via `rm -rf Agents/`. No `.gitmodules` exists to edit. **Git follow-up at commit time:** the user will need `git rm --cached Agents` to remove the gitlink from the index before the commit takes. Documented in [docs/cutover-runbook.md](cutover-runbook.md).

- **PR 15** — No behavior changes. Every deletion was preceded by a grep confirming zero references from the new tree. The two pre-deletion moves (utils + validate-name + shared types) preserved every existing import contract — only the import path strings changed.
