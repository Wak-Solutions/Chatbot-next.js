# Cutover runbook

Operational steps for the three production-affecting cutovers in the migration. Written for an engineer executing the cutover at 02:00 with no prior context — every command in full, every value explicit. If a step references something you can't find, **stop and ask** before continuing.

## Overview

The migration replaces the legacy Express dashboard and Python chatbot with three new services. Cutover happens in three production-affecting PRs:

| PR | Cutover | Result |
|---|---|---|
| **PR 11** (this runbook) | Production custom domain moves from the Express dashboard to **dashboard-next** (Next.js). Express keeps running in **CRON_ONLY mode** to drive the meeting-reminder cron only. | Dashboard UI + API served by Next.js. Webhook endpoints (`/api/incoming`, `/api/human-requested`, `/api/meetings/create-token`) now serve from Next.js too — Python keeps calling the same production domain, so no Python config change is needed at this step. Meeting reminders still fire from Express. |
| **PR 12** | Meeting-reminder cron moves from Express to the new **worker** service. | Express can be stopped after this — no longer serves any traffic or runs any timers. |
| **PR 13** | Meta webhook URL flips from the Python chatbot to the worker. Python retires. | The Python chatbot service can be stopped. The worker handles inbound Meta webhooks, dedup, push notifications, and the meeting cron. |

**Order is non-negotiable.** Dashboard before cron before webhook. Each cutover preserves the previous one's invariants.

A rollback is documented for each step. If anything looks wrong post-cutover and you cannot identify the cause within ~10 minutes, **roll back and investigate offline**. The rollback paths are tested for ~5-minute recovery.

## PR 11 cutover — dashboard

**Goal.** The production custom domain (e.g. `wak-agent.up.railway.app`) routes to the dashboard-next Railway service. The old Express service stops serving HTTP and runs only the meeting-reminder cron.

### Pre-cutover checklist

- [ ] **dashboard-next service deployed.** Railway dashboard → dashboard-next service is in "Active" state. Get its preview URL (Railway → service → Settings → Domains shows the Railway-assigned subdomain, typically `dashboard-next.up.railway.app` or similar). Use this for the smoke test below.

- [ ] **All env vars set on dashboard-next** — exact values copied from the OLD Express service unless noted otherwise. Railway dashboard → dashboard-next service → Variables. Every line below must be present:

  ```
  DATABASE_URL=<copy from OLD service — CRITICAL, must be identical>
  SESSION_SECRET=<copy from OLD service — CRITICAL, sessions break if different>
  OPENAI_API_KEY=<copy from OLD service>
  OPENAI_MODEL=gpt-4o-mini   # or whatever the OLD service has
  BREVO_API_KEY=<copy from OLD service>
  BREVO_FROM_EMAIL=<copy from OLD service>
  BREVO_FROM_NAME=<copy from OLD service>
  MANAGER_EMAIL=<copy from OLD service>
  DAILY_API_KEY=<copy from OLD service>
  VAPID_PUBLIC_KEY=<copy from OLD service>
  VAPID_PRIVATE_KEY=<copy from OLD service>
  VAPID_EMAIL=<copy from OLD service>
  RP_ID=<production domain WITHOUT scheme>      # e.g. wak-agent.up.railway.app
  RP_ORIGIN=https://<production domain>          # e.g. https://wak-agent.up.railway.app
  APP_URL=https://<production domain>
  NODE_ENV=production
  LOG_LEVEL=info
  ```

  **RP_ID and RP_ORIGIN must match the PRODUCTION domain, not the preview URL.** Stored WebAuthn credentials are bound to the RP_ID they were registered against. If RP_ID on dashboard-next does not match what users registered with on Express, biometric login will fail with `WEBAUTHN_RP_MISMATCH` for every existing user and they will see the re-registration prompt at next login. See "WebAuthn re-registration" under Manual steps.

- [ ] **Health endpoint responds on the dashboard-next preview URL:**

  ```bash
  curl -s https://dashboard-next.up.railway.app/api/health
  # Expect: {"status":"ok","database":"connected"}
  ```

  If you get 503 with `"database":"unreachable"`, DATABASE_URL is wrong. Fix before continuing.

- [ ] **Smoke-test dashboard-next using a synthetic session.** Cookies don't cross domains — you cannot copy your production session cookie onto the dashboard-next preview URL. Instead, inject a synthetic session row into the shared `session` table, sign its sid, and set the cookie manually in DevTools against the preview URL:

  1. Open the Supabase SQL editor (or `psql "$DATABASE_URL"` if you have direct access).

  2. Find a real admin agent to impersonate:

     ```sql
     SELECT id, name, company_id
     FROM agents
     WHERE role = 'admin' AND is_active = true
     LIMIT 1;
     ```

     Note the returned `id` and `company_id`.

  3. Insert a synthetic session row. Replace `<AGENT_ID>` and `<COMPANY_ID>` with the values from step 2:

     ```sql
     INSERT INTO session (sid, sess, expire)
     VALUES (
       'smoke-' || replace(gen_random_uuid()::text, '-', ''),
       jsonb_build_object(
         'cookie', jsonb_build_object(
           'originalMaxAge', 7*24*60*60*1000,
           'expires', to_char(NOW() + INTERVAL '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'httpOnly', true,
           'path', '/',
           'sameSite', 'lax',
           'secure', true
         ),
         'authenticated', true,
         'agentId', <AGENT_ID>,
         'companyId', <COMPANY_ID>,
         'role', 'admin',
         'agentName', 'Smoke Test',
         'isActive', true,
         'lastActiveCheck', (extract(epoch from now()) * 1000)::bigint
       ),
       NOW() + INTERVAL '1 hour'
     )
     RETURNING sid;
     ```

     Save the returned `sid`.

  4. Sign the sid with the same SESSION_SECRET dashboard-next uses. Run this from a terminal where you have Node installed:

     ```bash
     SID='<sid from step 3>'
     SECRET='<SESSION_SECRET value from dashboard-next env vars>'
     node -e "const c=require('crypto');const sig=c.createHmac('sha256',process.env.SECRET).update(process.env.SID).digest('base64').replace(/=+\$/,'');console.log('s:'+process.env.SID+'.'+sig)" SID="$SID" SECRET="$SECRET"
     # Output: s:<sid>.<sig> — this is the value to put in the connect.sid cookie.
     ```

  5. In Chrome DevTools (on dashboard-next.up.railway.app, any tab):
     - **Application → Storage → Cookies → https://dashboard-next.up.railway.app**
     - Click the empty row to add a new cookie:
       - Name: `connect.sid`
       - Value: `<the s:<sid>.<sig> string from step 4>`
       - Domain: `dashboard-next.up.railway.app`
       - Path: `/`
       - Expires: `Session`
       - HttpOnly: ✓
       - Secure: ✓
       - SameSite: `Lax`

  6. Navigate to `https://dashboard-next.up.railway.app/api/me`. Expect:

     ```json
     { "authenticated": true, "role": "admin", "agentId": <AGENT_ID>, "agentName": "Smoke Test", "termsAcceptedAt": null }
     ```

     If you get `{ "authenticated": false }`, the cookie isn't being sent — recheck the cookie value, the Domain, and that Secure is on (the preview URL is HTTPS).

  7. From DevTools console on the same origin:

     ```js
     fetch('/api/conversations', { credentials: 'include' }).then(r => r.json()).then(console.log)
     fetch('/api/inbox', { credentials: 'include' }).then(r => r.json()).then(console.log)
     fetch('/api/meetings', { credentials: 'include' }).then(r => r.json()).then(console.log)
     fetch('/api/me/trial', { credentials: 'include' }).then(r => r.json()).then(console.log)
     ```

     Expect 200 responses with real data from the impersonated company. Any 5xx means dashboard-next is not ready for cutover — stop and investigate.

  8. Navigate to `https://dashboard-next.up.railway.app/dashboard`. Expect the dashboard UI to render with the impersonated company's data.

  9. **Clean up.** Delete the synthetic session row when smoke is complete:

     ```sql
     DELETE FROM session WHERE sid = '<sid from step 3>';
     ```

- [ ] **Verify prod sessions will survive the flip.** Because dashboard-next uses the same SESSION_SECRET and the same `session` table as Express, any real user's cookie verifies on dashboard-next post-cutover and picks up the existing session row. No user re-login is required. The CSRF token cookie (`csrf-token`) also carries through — same domain post-cutover, same cookie name.

- [ ] **Confirm Meta webhook stays untouched.** Meta App Console webhook URL still points at the Python chatbot service. PR 11 does not change this. Python continues to receive Meta webhooks and continues to POST `/api/incoming`, `/api/human-requested`, `/api/meetings/create-token` against the production domain. After the cutover, those POSTs land on dashboard-next — which serves the equivalent endpoints (PR 7 + PR 8).

### Maintenance window timing

- **KSA timezone (UTC+3), Saturday 23:00 – Sunday 02:00 KSA.** Lowest customer message volume.
- **Expected duration:** 10–15 minutes for the flip + 30–60 minutes of post-cutover monitoring before standing down.
- **Communications:** announce to admins ~24h before so they expect a brief window where the dashboard may be unreachable.

### Cutover steps

Execute these in order. Do not skip steps even if you think you know what they do.

1. **Open Railway dashboard.** Have both services visible: the OLD Express service (typically `wak-dash` or similar — confirm by looking at its `start` script: `NODE_ENV=production node dist/index.cjs`) and the dashboard-next service.

2. **Remove the production custom domain from the OLD service.**
   - Railway → OLD service → Settings → Domains.
   - Find the production domain (e.g. `wak-agent.up.railway.app`).
   - Click the `…` menu next to it → Remove.
   - Confirm the removal.

3. **Add the production custom domain to dashboard-next.**
   - Railway → dashboard-next → Settings → Domains → Add Domain.
   - Enter the same production domain.
   - Railway provisions/transfers the certificate. Wait until the Domains page shows the domain as "Active" with a valid certificate (~30s to 2 min).

4. **Verify the domain now serves dashboard-next:**

   ```bash
   curl -s https://<production-domain>/api/health
   # Expect: {"status":"ok","database":"connected"}
   ```

   If you get a 502/503 here, the domain transfer isn't complete yet. Wait another 30s and retry. If it doesn't come up within ~3 minutes, see Rollback.

5. **Set CRON_ONLY=1 on the OLD Express service.**
   - Railway → OLD service → Variables → Add Variable.
   - Name: `CRON_ONLY`
   - Value: `1`
   - Click Add. Railway redeploys the OLD service automatically.

6. **Watch the OLD service logs.** Within ~30s of the redeploy completing, you should see exactly this line:

   ```
   [INFO] [index] [cron-only] meeting reminder cron started, http listener disabled
   ```

   If you do not see this line, the gate didn't fire — either CRON_ONLY isn't set (typo, wrong service), or the deploy hasn't picked it up. Force a redeploy: Railway → OLD service → Deployments → "Redeploy" on the latest deployment. If the line still doesn't appear, **see Rollback**.

### Post-cutover smoke (against the production domain)

Run these in order. Any failure → **see Rollback**.

- [ ] `https://<production-domain>` loads. Expect the landing page or login (depending on session state).
- [ ] **Log in** with a real admin account using email + password. Expect redirect to `/dashboard`. The dashboard UI loads with the company's data.
- [ ] **Open `/inbox`.** Expect the conversation feed.
- [ ] **Open `/meetings`.** Expect the meetings list.
- [ ] **Open `/settings`.** Expect the settings tabs (Branding, WhatsApp, Work Hours).
- [ ] **Open `/chatbot-config`.** Wait for the structured editor to load. Make a no-op change (toggle a field and revert), click Save. Expect 200 OK and a "Saved" toast.
- [ ] **Send a test message** from `/dashboard` to a known test customer phone (e.g. an internal QA WhatsApp number). The test customer should receive the message on WhatsApp within seconds.
- [ ] **Check OLD service logs** for `[INFO] [meeting-reminders]` lines if any meetings have `scheduled_at` within the 15-minute window. If no meetings are due, no log lines is expected — the cron is silent when there's nothing to do.
- [ ] **Check dashboard-next logs** for `Inbound message received from bot` lines as Python posts to `/api/incoming`. The rate should match what Express was getting pre-cutover. If it drops to zero, Python is hitting the old URL — verify Python's `DASHBOARD_URL` env var matches the production domain.

### Rollback (~5 minutes)

If any post-cutover smoke check fails and you cannot fix it in under ~10 minutes:

1. **Move the production domain back to the OLD service.**
   - Railway → dashboard-next → Settings → Domains → remove the production domain.
   - Railway → OLD Express service → Settings → Domains → Add Domain → enter the production domain.
   - Wait for the certificate to provision (~30s to 2 min).

2. **Verify the domain serves OLD again:**

   ```bash
   curl -s https://<production-domain>/health
   # Expect the Express-style health response (slightly different from dashboard-next).
   ```

3. **Turn off CRON_ONLY on the OLD service.**
   - Railway → OLD service → Variables → find `CRON_ONLY` → Delete.
   - Railway redeploys automatically. Watch the logs: you should see the normal Express boot sequence (no `[cron-only]` line, but the regular `serving on http://0.0.0.0:5000` line at the end).

4. **Verify a real login works** on the production domain via the OLD client.

5. **File the incident.** Note exactly which post-cutover smoke step failed and what the symptom was — that's what blocks the next attempt.

## PR 12 cutover — meeting reminder cron

**Goal.** The meeting-reminder cron moves from the OLD Express service (running in CRON_ONLY mode from PR 11) to the new **worker** service. After this cutover, the OLD Express service can be stopped entirely — it no longer serves any traffic or runs any timers.

**Prerequisite.** PR 11 cutover is complete. The production custom domain points to dashboard-next. The OLD Express service is running with `CRON_ONLY=1` and showing `[INFO] [index] [cron-only] meeting reminder cron started` in its logs.

### Two-writer overlap — by design, not a bug

Steps 2 through 4 below leave BOTH services running the reminder cron simultaneously. This is intentional. The atomic `UPDATE meetings SET link_sent = TRUE WHERE link_sent = FALSE RETURNING id` claim pattern in `@lib/meetings/reminders.claimReminder` guarantees that exactly one writer wins per meeting — the other sees an empty RETURNING and skips. Verification that this is actually true (no customer receives two reminders for the same meeting) is the GOAL of the verification window in step 3.

**Do not** add a "stop the OLD Express first" step. We want the overlap so we can observe both writers contending against the live data before retiring the OLD path.

### Pre-cutover checklist

- [ ] **worker-next service deployed.** Railway → worker-next service shows "Active". Get its preview URL (Railway → service → Settings → Domains; typically `worker-next.up.railway.app`).

- [ ] **All env vars set on worker-next.** Same DB pool + WhatsApp/Brevo creds as the OLD service. Required:

  ```
  DATABASE_URL=<copy from OLD service — must be identical>
  OPENAI_API_KEY=<copy from OLD service>
  OPENAI_MODEL=gpt-4o-mini   # or whatever the OLD service has
  VERIFY_TOKEN=<32+ char Meta-webhook token — set even for PR 12; PR 13 consumes it>
  DASHBOARD_URL=https://<production domain>   # for booking-link construction
  NODE_ENV=production
  LOG_LEVEL=info
  CRON_ENABLED=0   # start DISABLED — flip in step 2 below
  ```

  `CRON_ENABLED=0` is the safe default. With it set to `0` (or unset, or anything other than literal `"1"`), the worker boots cleanly, binds `/health`, and waits — it does not fire reminder claims.

- [ ] **Health probe responds on the worker preview URL:**

  ```bash
  curl -s https://worker-next.up.railway.app/health
  # Expect: {"status":"ok","database":"connected","service":"worker"}
  ```

  `"service":"worker"` distinguishes this from dashboard-next's `/api/health`.

- [ ] **Verify the cron is OFF.** In Railway → worker-next → Logs, search for the boot line. You should see:

  ```
  [INFO] [worker] Meeting reminder cron DISABLED (set CRON_ENABLED=1 to enable)
  ```

  If you see `Meeting reminder cron started`, abort and set `CRON_ENABLED=0`. The cutover relies on the worker NOT firing reminders until you explicitly flip the flag.

### Maintenance window timing

Less critical than PR 11 — the cutover is gradual (overlap window for verification). Suggested: same KSA off-peak window as PR 11 (Saturday 23:00 KSA) for the flip, then a 24-hour observation window.

### Cutover steps

1. **Confirm pre-cutover checklist is clean.** Worker deployed, env vars set, `/health` green, cron disabled. Do not proceed unless every box is checked.

2. **Flip `CRON_ENABLED=1` on worker-next.**
   - Railway → worker-next → Variables → find `CRON_ENABLED` → set value to `1` → Save.
   - Railway redeploys the service automatically. Within ~30s of the new deploy reaching "Active", the worker logs should show:

     ```
     [INFO] [worker] Meeting reminder cron started, interval_ms: 60000
     ```

   - From this moment, BOTH worker-next and OLD Express are running the reminder cron against the same `meetings` table. The atomic UPDATE is the race protection.

3. **Verification window (24h or ≥5 reminder claims observed, whichever is longer).** Watch the logs of BOTH services concurrently.

   What you're looking for:
   - **Both services' logs SHOULD show `Reminder sent` lines** as meetings come due. The mix depends on which service wins each atomic claim; expect roughly 50/50 over a large sample, but per-meeting it's a coin flip — that's fine.
   - **Each meeting's reminder should appear in exactly ONE service's logs**, NOT both. If you see the same `meetingId` in both services' `Reminder sent` lines, the claim is broken — see Rollback immediately.
   - **No customer should receive two WhatsApp reminders for the same meeting.** Spot-check a couple of recent reminders by phone in the QA WhatsApp inbox.

   If reminder volume is too low to observe ≥5 claims in 24h, extend the window. Do not move on with sparse data — the whole point of the overlap is to observe the claim under live traffic.

   Useful log searches:

   ```
   # In Railway → worker-next → Logs:
   "Reminder sent"
   "Reminder send failed — released claim"
   "Reminder tick failed"

   # In Railway → OLD Express service → Logs (CRON_ONLY mode):
   "Reminder sent"
   "Reminder send failed — released claim"
   "Reminder tick failed"
   ```

   The grep targets are identical between services so a single saved search works for both.

4. **Stop the OLD Express service.** Once the verification window is satisfied:
   - Railway → OLD Express service → click the service → top-right Settings → bottom of the page → **Pause Service** (or "Stop"). The exact button name depends on Railway's UI — pick the one that stops the running deployment without deleting config.
   - Wait ~30s. The service should show "Paused" or "Stopped".

5. **Verify the next reminder cycle fires ONLY from worker-next.** Wait until a meeting comes due (or use the verification window's last data points). Confirm:
   - `Reminder sent` appears in worker-next logs.
   - OLD service logs show no activity (service is paused).
   - The customer receives exactly one reminder.

### Post-cutover smoke

- [ ] Worker `/health` still returns 200 on the worker preview URL.
- [ ] Recent meeting reminders fired only from worker-next.
- [ ] No customer reports of duplicate reminders during the overlap window.
- [ ] Push notifications, dashboard, /api/incoming traffic from Python — all unchanged from PR 11 (these endpoints all live on dashboard-next; the worker cron is independent).

### Rollback (~2 minutes)

If reminders break in the verification window or after retiring OLD Express:

1. **Stop worker-next cron.** Railway → worker-next → Variables → `CRON_ENABLED` → set to `0` → save. Railway redeploys; the worker keeps running but `Meeting reminder cron DISABLED` reappears in logs.

2. **Restart OLD Express (if it was stopped in step 4 above).** Railway → OLD Express → resume / unpause the service.

3. **Verify OLD Express resumed cron mode.** Logs should show `[cron-only] meeting reminder cron started` again. `CRON_ONLY=1` was NOT changed — it was already set from PR 11, so the OLD service comes back in cron-only mode automatically.

4. **Confirm reminders fire from OLD Express only.** Wait for the next due meeting; verify `Reminder sent` in OLD service logs and silence in worker-next.

If the worker is broken in a way that requires more than a flag flip, leave `CRON_ENABLED=0` on the worker; OLD Express resumes the cron as before PR 12.

## PR 13 cutover — Meta webhook URL + Python retirement

**Goal.** The Meta App Console webhook URL moves from the Python chatbot service to the worker-next service. After this cutover, the Python container can be stopped and the dashboard-next service redeployed without the three legacy receive routes (`/api/incoming`, `/api/human-requested`, `/api/meetings/create-token`) — they're deleted in this PR.

**Prerequisite.** PR 11 + PR 12 cutovers complete. Production traffic is split:
- dashboard-next serves the production HTTP domain (PR 11).
- worker-next runs the meeting-reminder cron with `CRON_ENABLED=1` (PR 12). OLD Express is paused/stopped.
- Python is still receiving Meta webhooks at its existing URL and POSTing to dashboard-next.

### Sequencing of code vs operational steps

This PR deletes `app/api/incoming`, `app/api/human-requested`, and `app/api/meetings/create-token` from the codebase. **Do NOT redeploy dashboard-next with that deletion until Python has been stopped** — Python is still posting to those URLs and a premature redeploy will 404 every inbound message. Order:

1. Deploy worker-next with `/webhook` (this PR's code, but BEFORE the dashboard-route deletion is deployed).
2. Smoke + cutover the Meta webhook URL.
3. Stop Python.
4. Confirm Python is fully stopped (24-hour quiet period; runbook step 8).
5. Redeploy dashboard-next with the routes deleted.

The dashboard routes can technically stay live in production for the entire window since the CSRF allowlist still lets them through (PR 4 — they're "webhook-allowlisted"). Deleting them in this PR is just code cleanup; the deploy of that cleanup waits for Python to be gone.

### Pre-cutover checklist

- [ ] **worker-next env vars include the webhook contract.** Railway → worker-next → Variables. All env vars from PR 12 plus:

  ```
  VERIFY_TOKEN=<the EXACT verify-token registered with Meta — must match the value Meta sends in the GET handshake>
  DASHBOARD_URL=https://<production domain>   # used by booking-link URLs
  ```

  Both already required by the worker's `loadWorkerEnv()` since PR 12, but **verify the VERIFY_TOKEN value matches what's registered in Meta App Console** — see "Where to find the verify token" below.

- [ ] **Worker `/webhook` GET handshake works locally.** From your laptop, hit the worker with the verify-token Meta will send:

  ```bash
  TOKEN='<VERIFY_TOKEN value>'
  curl -s "https://worker-next.up.railway.app/webhook?hub.mode=subscribe&hub.verify_token=$TOKEN&hub.challenge=test-challenge-12345"
  # Expect: test-challenge-12345
  ```

  If you get `Forbidden`, the worker's `VERIFY_TOKEN` doesn't match. If you get `Misconfigured`, `VERIFY_TOKEN` isn't set on the worker.

- [ ] **Worker `/webhook` POST verifies a fabricated signature.** Sign a synthetic payload with a known company's app_secret and POST it. Replace `<APP_SECRET>` with the value from `companies.whatsapp_app_secret` for a test company:

  ```bash
  APP_SECRET='<value from companies.whatsapp_app_secret for the test company>'
  PHONE_NUMBER_ID='<that company's whatsapp_phone_number_id>'
  TEST_PHONE='<your test customer WhatsApp number, no + prefix>'
  BODY="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"1\",\"changes\":[{\"field\":\"messages\",\"value\":{\"metadata\":{\"phone_number_id\":\"$PHONE_NUMBER_ID\"},\"messages\":[{\"id\":\"smoke-$(date +%s)\",\"from\":\"$TEST_PHONE\",\"timestamp\":\"$(date +%s)\",\"type\":\"text\",\"text\":{\"body\":\"smoke test\"}}]}}]}]}"
  SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$APP_SECRET" -hex | awk '{print $2}')"
  curl -s -X POST https://worker-next.up.railway.app/webhook \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: $SIG" \
    -d "$BODY"
  # Expect: {"status":"ok"}
  ```

  Then watch worker-next logs for `Message received` followed by the orchestrator's pipeline ending in a Meta send. The test customer (your test WhatsApp number) should receive a bot reply within seconds.

- [ ] **Cross-service idempotency check.** While Python is still receiving webhooks, manually trigger a duplicate to confirm the `processed_messages.ON CONFLICT` path works across services:

  1. From production Meta logs (or by sending a real test message), capture a `message_id` Python just processed.
  2. Verify the row exists:

     ```sql
     SELECT * FROM processed_messages WHERE message_id = '<that id>';
     ```

  3. Replay the same payload to the worker's `/webhook` with the same id:

     ```bash
     # Reuse the BODY + SIG construction above, but force the message_id:
     BODY="{...,\"id\":\"<the exact id Python wrote>\",...}"
     # Re-sign + POST as before.
     ```

  4. Watch worker-next logs. You should see:

     ```
     Duplicate webhook delivery — messageId: <that id>, skipping
     ```

     The worker no-ops and returns 200. No second bot reply fires.

  If the duplicate fires a second reply, `claimMessageId` is broken. Stop and investigate — don't proceed with cutover.

- [ ] **`raw_inbound_messages` is being populated by the worker.** During the smoke test, `SELECT COUNT(*) FROM raw_inbound_messages WHERE created_at > NOW() - INTERVAL '5 minutes'` should be > 0.

- [ ] **Prompt cache invalidation hook works.** In dashboard-next, edit a tenant's chatbot config and save. Then within ≤2s, send a new test message from the test customer phone. The bot's reply should reflect the new prompt. (Dashboard-next's POST `/api/chatbot-config` calls `invalidatePromptCache(companyId)` — same-process so the dashboard's preview is immediate; the worker's separate cache still has 60s TTL freshness for the unseen-by-dashboard case.)

### Where to find the verify token + Meta App Console URL

Meta App Console UI changes over time — here's what to look for as of writing:

1. https://developers.facebook.com/apps → select the WAK Solutions app (App ID is on the dashboard; record it before changing anything).
2. Left sidebar → **WhatsApp** → **Configuration**.
3. **Webhook** section shows two fields:
   - **Callback URL** — currently `https://<python-service>.up.railway.app/webhook`. This is what you change.
   - **Verify token** — the shared secret. Confirm it matches the `VERIFY_TOKEN` env var on worker-next BEFORE clicking Verify and save.
4. **Webhook fields** subsection shows which event types are subscribed (`messages`, etc.). Leave these unchanged.

Record the EXACT URL and verify-token values before the change so the rollback step has them.

### Maintenance window timing

KSA off-peak, same as PR 11 — Saturday 23:00 KSA. Expected duration: 5-10 minutes for the Meta URL swap + 60-minute observation.

### Cutover steps

1. **Confirm pre-cutover checklist is clean.**

2. **Update Meta App Console webhook URL.**
   - Open the Webhook section per "Where to find" above.
   - Click **Edit**.
   - Replace **Callback URL** with `https://worker-next.up.railway.app/webhook` (or whatever the worker's public URL is — Railway → worker-next → Settings → Domains).
   - Leave **Verify token** unchanged (must match worker's VERIFY_TOKEN).
   - Click **Verify and save**. Meta sends a GET `/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...` to the new URL — the worker should respond with the challenge value verbatim, and Meta's UI shows ✅ Verified.
   - If verification fails: rollback (see below).

3. **Send a real test message** from the test customer phone (a phone you control, NOT a real customer).
   - In worker-next logs: search for `Message received`. Followed by `OpenAI request`. Followed by `Reply sent` or `Reminder sent` (depending on the test).
   - The test customer should receive a real bot reply via WhatsApp.

4. **Watch for ~10 minutes** that real customer messages are flowing through the worker. Search worker-next logs for `Message received` — the rate should match the rate Python was receiving.

### Post-cutover smoke

- [ ] Test customer receives a bot reply within seconds of sending a message.
- [ ] Test customer receives a bot reply within seconds of sending a voice note (Whisper transcription).
- [ ] Test booking flow: send the customer-asking-for-meeting test phrase ("yes" right after the bot offers a meeting). The booking link sent should be `https://<production domain>/book/<token>`.
- [ ] Test human escalation: send "I want a human agent". Dashboard receives a "Human Requested" push notification.

### 24-hour observation window

Watch for:

| Metric | Where | What good looks like | What bad looks like |
|---|---|---|---|
| `Message received` rate on worker-next | Railway → worker-next → Logs | Matches the rate Python was getting pre-cutover | Sustained drop — Meta is still hitting Python (rollback) or worker's signature verify is rejecting (403 in logs) |
| Signature failures (403) | Railway → worker-next → Logs, search "signature mismatch" | Zero or very rare (only from spoofers) | Sustained 403s for known-good phone_number_ids — `companies.whatsapp_app_secret` is wrong for a tenant |
| OpenAI call rate | Railway → worker-next → Logs, search "OpenAI request" | Matches inbound message rate (minus menu-handled and 1/2-routed turns) | Sustained zero — orchestrator is broken; check for `OpenAI timeout` log lines |
| Meta send success | Railway → worker-next → Logs, search "Reply sent" | Matches OpenAI call rate | Sustained zero — Meta send is failing, possibly token issue. Check `getWhatsappCreds` errors. |
| Push notifications to dashboard | Railway → dashboard-next → Logs, search "Push sent" | Steady. First inbound per session fires "New Chat"; deduped by chat_notified. | Sustained zero — dashboard subscription table empty, or VAPID misconfigured. |
| Duplicate replies | QA WhatsApp inbox | Customers never receive two replies for one message | Even one duplicate = `claimMessageId` is broken. Stop and investigate. |

### Stop Python and clean up

5. **After 24 hours of clean operation:** stop the Python container.
   - Railway → Python service → **Pause Service** (or Stop). The exact button name depends on Railway's UI.
   - Wait 5-10 minutes. Confirm no entries in worker-next logs about missed Python posts (there shouldn't be any since Python only POSTs OUT and is now stopped).

6. **Verify next bot turn fires only from the worker.** Send a test message. Single reply, from the worker.

7. **Redeploy dashboard-next with the route deletions.** This PR removes `app/api/incoming`, `app/api/human-requested`, `app/api/meetings/create-token` from the codebase. Now that Python is stopped, nothing else calls those URLs.
   - Railway → dashboard-next → trigger a redeploy on the branch that contains this PR's deletions.
   - After redeploy, those URLs return Next.js 404. That's fine — no caller depends on them.

8. **Final entry in this runbook:** Python retired at `<timestamp>`. The Python container can stay paused indefinitely. **`Chatbot/workers/link_delivery.py` is gone and `meetings.link_sent` is single-writer (Node worker only). If Python is ever resurrected for any reason, that file must stay deleted** — otherwise we'd have two writers racing on the same atomic claim and the race protection only works because the worker is the sole writer of that column post-PR-12.

### Rollback (~10 minutes)

If the cutover goes sideways at any step:

1. **Swap Meta App Console webhook URL back to `https://<python-service>.up.railway.app/webhook`.**
   - Meta App Console → WhatsApp → Configuration → Edit Webhook.
   - Restore the original Callback URL.
   - Click Verify and save.

2. **Restart the Python container.** Railway → Python service → Resume / Unpause. Wait for "Active" state.

3. **`git revert` the deletion commit of the three dashboard routes** so `app/api/incoming`, `app/api/human-requested`, `app/api/meetings/create-token` exist again. Redeploy dashboard-next. (Skip this step if the rollback happens before the post-Python-stop dashboard redeploy.)

4. **Verify Python is receiving webhooks again.** Send a test message; check Python service logs for the inbound + Python posting to dashboard-next at the legacy routes.

Total rollback: ~10 minutes (Meta console ~2 min + Python restart ~2 min + dashboard redeploy ~5 min).

## Manual steps

### WebAuthn re-registration

The PR 10 login page surfaces a specific re-registration prompt on `WEBAUTHN_RP_MISMATCH`:

> "Your biometric login is no longer valid for this domain. Please sign in with your password, then re-register your biometric in Settings."

This fires if dashboard-next's `RP_ID` env var differs from what users registered with under Express. Because dashboard-next inherits the same production domain after cutover, `RP_ID` should match and no user should see this prompt. If they do:

1. User signs in with email + password.
2. User opens `/settings` → Security → Re-register biometric.
3. The new credential is bound to dashboard-next's current `RP_ID` (the production domain).

If **every** user sees this prompt at once, `RP_ID` is set wrong on dashboard-next. See Rollback and fix the env var.

### Cleaning up the `Agents/` submodule on commit (PR 15)

PR 15 removed `Agents/` from the working tree with `rm -rf`. There was no `.gitmodules` file to edit. However, if `Agents` was ever previously registered as a git submodule (or a gitlink commit was recorded), git's index may still carry a stale reference. When you're ready to commit PR 15:

```bash
# Run from the repo root, in this order:
git rm --cached Agents 2>/dev/null || true
git status   # confirm Agents is no longer staged
# Then stage + commit the rest of PR 15 normally.
```

`git rm --cached Agents` removes the gitlink from the index without touching the working tree (the dir is already gone). The `|| true` swallows the case where the cache entry doesn't exist — harmless.

If `git status` still mentions `Agents` after the above, `git ls-files --stage | grep Agents` will show the lingering entry; remove with `git rm --cached --ignore-unmatch <path>`.

### Database baseline (run ONCE after PR 14 deploys)

The first time PR 14 (or later) is deployed to production, the dashboard's `preDeployCommand` will run `npx tsx scripts/migrate.ts`. On a fresh database with no prior Drizzle journal, that command would try to apply [drizzle/0000_baseline.sql](drizzle/0000_baseline.sql) — but production already has every table that file creates. Without the baseline mark, the migration fails with `relation already exists` and the deploy is blocked.

**Run this exactly once**, before (or as part of) the first PR 14 deploy:

```bash
DATABASE_URL='<production DATABASE_URL>' npx tsx scripts/mark-baseline.ts
```

What it does:
- Creates the `drizzle` schema if missing.
- Creates `drizzle.__drizzle_migrations` if missing.
- Inserts a row whose `hash` is the SHA-256 of `drizzle/0000_baseline.sql`, marking it as already applied.
- Safe to re-run — `ON CONFLICT (hash) DO NOTHING`.

After this runs once, every subsequent `scripts/migrate.ts` invocation sees the baseline as applied and only applies migrations added AFTER PR 14. From PR 14 onward, schema changes flow through Drizzle's `generate` → commit → predeploy-apply pipeline (see [README.md](../README.md) → Database migrations).

This is a one-time runbook step per the Phase 2 plan §5 step 4.

### Rotated secrets

PR 11 does not require any secret rotation. All of these are copied verbatim from the OLD service to dashboard-next:

- `SESSION_SECRET` (must be identical — sessions break otherwise)
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME`, `MANAGER_EMAIL`
- `DAILY_API_KEY`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`
- `RP_ID`, `RP_ORIGIN`, `APP_URL`

If you rotate any of these as part of cutover (not recommended — combine with a separate rotation window), update both services before the flip.

### Meta App Console URL change

**NOT in scope for PR 11.** Python continues to receive Meta webhooks at its existing URL. Python's outbound calls (to `/api/incoming` etc.) land on the production domain, which post-cutover routes to dashboard-next. PR 13 is when the Meta webhook itself moves to the worker.

## Behavior changes that affect cutover

Pulled from `docs/migration-divergences.md`. Items the on-call engineer needs to know about:

- **PR 7 — `/api/send` advisory lock on conversation_id reuse.** No user-visible change for normal sends. Under concurrent agent sends to the same customer, dashboard-next mints one `conversation_id` where Express would mint two. Affects analytics joins on `conversation_id` but not the chat flow.

- **PR 7 — in-memory push-notification dedup Map (`lib/notifications/push.ts`).** Express and dashboard-next each have their own Map; both are backed by the `chat_notified` table. After cutover, the first inbound message on each ongoing session MAY re-fire a "New Chat" push notification if Express had marked the key in its Map but dashboard-next hasn't seen it yet. The DB row prevents repeated fires within the 24-hour TTL.

- **PR 7 — `lib/companies/creds.ts` reads creds from the DB on every call (no cache).** A rotated WhatsApp token takes effect on dashboard-next on the very next send. The OLD Express service in CRON_ONLY mode still uses its legacy cred path; not relevant after PR 12.

- **PR 8 — `lib/meetings/createToken.ts` uses SHA-256-based lock keys** (not Python's process-local `hash()`). Only relevant once the worker writes booking tokens too (PR 13). No effect on PR 11 cutover.

- **PR 10 — WebAuthn `WEBAUTHN_RP_MISMATCH` re-registration prompt.** Visible only if `RP_ID` on dashboard-next is wrong. See Manual steps.

- **PR 11 — `CRON_ONLY=1` flag on Express** (this PR). Operational mode only; no user-visible change. The flag exists so PR 11 can keep the meeting-reminder cron running on Express until PR 12 moves the cron to the worker. PR 15 cleanup deletes the flag along with the rest of the Express service.

## Post-cutover monitoring (first 24 hours)

Watch each of these. Alert if any sustains beyond the threshold.

| Metric | Where to look | What good looks like | What bad looks like |
|---|---|---|---|
| **Login success rate** | Railway → dashboard-next → Logs, filter `Login success`/`Login failed` | Same rate as 24h before cutover | Sustained spike in `Invalid credentials` — points at SESSION_SECRET mismatch or session table issue. |
| **/api/incoming traffic from Python** | Railway → dashboard-next → Logs, filter `Inbound message received from bot` | Steady rate matching pre-cutover. Python should be hitting dashboard-next at the same QPS it was hitting Express. | Drop to zero — Python config wrong, or Python pointing at the wrong host. Check Python `DASHBOARD_URL`. |
| **/api/meetings/create-token** | Railway → dashboard-next → Logs, filter `Meeting token created` | Matches pre-cutover rate | Drop — Python config or `x-webhook-secret` mismatch (verify the secret per-company in the `companies.webhook_secret` column). |
| **Meeting reminder cron** | Railway → OLD Express service → Logs, filter `Reminder sent` | Same volume as pre-cutover. Cron ticks every minute; reminders fire 15 minutes before `scheduled_at`. | Zero — cron didn't start. Verify the `[cron-only] meeting reminder cron started` line appeared at boot. If not, force a redeploy. |
| **5xx error rate** | Railway → dashboard-next → Logs, filter for 500/502/503 | < 0.1% of total requests | Sustained 5xx — usually a missing route or DB connectivity issue. Page the on-call engineer. |
| **WebAuthn login success** | Railway → dashboard-next → Logs, filter `WebAuthn login success` | Same rate as 24h before, modulo users on stale `RP_ID` who fall back to password | Mass failure with `WEBAUTHN_RP_MISMATCH` — `RP_ID` env var wrong on dashboard-next. |
| **Push notification fan-out** | Railway → dashboard-next → Logs, filter `Push sent to all agents` | Steady. May spike briefly after cutover (see PR 7 dedup-cache note above). | Sustained zero — VAPID env vars missing or wrong on dashboard-next. |

If any of these go bad and the fix isn't obvious within ~10 minutes, **roll back** rather than debugging on prod traffic.

## Quick reference — what files this runbook touches

- `server/index.ts` — adds the `CRON_ONLY=1` gate (PR 11).
- `docs/migration-divergences.md` — lists the `CRON_ONLY` flag for PR 15 cleanup.
- This file — operational checklist. PR 12 and PR 13 sections to be filled in.

## Railway deployment workarounds (intentional, do not remove)

Both Railway services (Next-Dashboard, Next-Chatbot) have two non-obvious
environment variables that the code does NOT reference directly. They are
build-environment workarounds for known Nixpacks behavior:

- **`NIXPACKS_NODE_VERSION=20`** — Nixpacks (v1.41.0) defaults to Node 18 on
  the Ubuntu-1745885067 base image. Several deps require Node 20+:
  `@peculiar/x509@1.14.3`, `@simplewebauthn/server@13.3.0`, `vite@7.3.2`,
  `vitest@4.1.4`. Without this var, `npm ci` leaves partial install state
  and the build fails with
  `EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'`.

- **`NPM_CONFIG_PRODUCTION=false`** — `NODE_ENV=production` (set via the
  env schema) causes npm to omit `devDependencies`. The Next.js build-time
  toolchain (`autoprefixer`, `postcss`, `tailwindcss`, plus `tsup` for the
  worker) lives in devDeps. Without this var, `next build` fails with
  `Cannot find module 'autoprefixer'`.

Both could in principle be replaced by source-tree changes (`.nvmrc`,
moving build deps to `dependencies`) but the env-var approach keeps
`package.json` unchanged.

## Meeting reminder cron

The new worker (Next-Chatbot) starts the meeting reminder cron only when
`CRON_ENABLED=1` is set on the service. The legacy Express `CRON_ONLY=1`
service has been retired (FAILED, 0 active deploys in the `Wak Chatbot`
project). Without `CRON_ENABLED=1`, no reminders fire anywhere. Boot log
to verify: `Meeting reminder cron started ... interval_ms=60000`.

Empty ticks are silent by design (no log when no meetings are due).
Look for `Reminder sent`, `Reminder send failed`, or `Reminder tick failed`
to confirm activity.
