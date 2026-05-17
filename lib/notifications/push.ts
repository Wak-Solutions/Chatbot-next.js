/**
 * Web Push notifications — port of server/push.ts.
 *
 * VAPID setup runs lazily on first use so the module loads cleanly when
 * the env vars aren't present (typecheck, tests). When VAPID keys are
 * unset, all delivery helpers no-op (logged as warning).
 *
 * The notifiedChats Map + chat_notified DB table form a two-layer dedup:
 *   - Map hit  : free, returns true.
 *   - Map miss : DB lookup (first message after a process restart only).
 * Entries expire from the DB after 24h (same TTL as a conversation
 * session). Cleared per-key by deleteNotified, which the dashboard's
 * mark-read endpoint calls when the agent acknowledges the chat.
 *
 * notifyAll / notifyAgent / notifyAdmins broadcast to push_subscriptions
 * rows, optionally scoped to a company. Delivery failures of
 * 410 / 404 / 403 prune the dead subscription row.
 */

import webpush from 'web-push';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('push');

let _vapidConfigured: boolean | null = null;
function ensureVapid(): boolean {
  if (_vapidConfigured !== null) return _vapidConfigured;
  const pub = process.env.VAPID_PUBLIC_KEY ?? '';
  const priv = process.env.VAPID_PRIVATE_KEY ?? '';
  const email = process.env.VAPID_EMAIL ?? '';
  if (pub && priv) {
    if (!email) {
      logger.warn('VAPID_EMAIL not set — push notifications will be disabled');
      _vapidConfigured = false;
      return false;
    }
    webpush.setVapidDetails(email, pub, priv);
    logger.info('VAPID keys configured');
    _vapidConfigured = true;
    return true;
  }
  logger.warn('VAPID keys not set — push notifications will be disabled');
  _vapidConfigured = false;
  return false;
}

export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? '';
}

// ─── DB-backed dedup set with in-memory cache ────────────────────────────

const MAX_NOTIFIED = 10_000;
const notifiedChats = new Map<string, true>();

export async function addNotified(key: string): Promise<void> {
  if (notifiedChats.size >= MAX_NOTIFIED) {
    const oldest = notifiedChats.keys().next().value;
    if (oldest !== undefined) notifiedChats.delete(oldest);
  }
  notifiedChats.set(key, true);
  // Fire-and-forget — failure here is non-fatal (worst case: one extra
  // notification after a restart).
  getPool()
    .query(
      `INSERT INTO chat_notified (key, notified_at) VALUES ($1, NOW())
       ON CONFLICT (key) DO UPDATE SET notified_at = NOW()`,
      [key],
    )
    .catch((err: Error) =>
      logger.error({ key, err: err.message }, 'chat_notified insert failed'),
    );
}

export async function hasNotified(key: string): Promise<boolean> {
  if (notifiedChats.has(key)) return true;
  try {
    const r = await getPool().query(
      `SELECT 1 FROM chat_notified
       WHERE key = $1 AND notified_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [key],
    );
    if (r.rows.length > 0) {
      notifiedChats.set(key, true);
      return true;
    }
  } catch (err) {
    logger.error({ key, err: (err as Error)?.message }, 'chat_notified lookup failed');
  }
  return false;
}

export async function deleteNotified(key: string): Promise<void> {
  notifiedChats.delete(key);
  getPool()
    .query('DELETE FROM chat_notified WHERE key = $1', [key])
    .catch((err: Error) =>
      logger.error({ key, err: err.message }, 'chat_notified delete failed'),
    );
}

// ─── Subscription management ─────────────────────────────────────────────

export interface PushSubscription {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
  [k: string]: unknown;
}

export async function registerSubscription(
  agentId: number,
  companyId: number,
  subscription: PushSubscription,
): Promise<void> {
  await getPool().query(
    `INSERT INTO push_subscriptions (agent_id, endpoint, subscription, company_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ON CONSTRAINT push_subscriptions_endpoint_key
     DO UPDATE SET agent_id = $1, subscription = $3, company_id = $4, updated_at = NOW()`,
    [agentId, subscription.endpoint, JSON.stringify(subscription), companyId],
  );
  logger.info({ agentId }, 'Push subscription persisted');
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await getPool().query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

export async function removeSubscriptionForAgent(
  endpoint: string,
  agentId: number,
  companyId: number,
): Promise<void> {
  await getPool().query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND agent_id = $2 AND company_id = $3',
    [endpoint, agentId, companyId],
  );
}

// ─── Low-level delivery — prunes 410/404/403 endpoints ───────────────────

interface SubscriptionRow {
  endpoint: string;
  subscription: string | PushSubscription;
}

async function sendPush(row: SubscriptionRow, payload: object): Promise<void> {
  if (!ensureVapid()) return;
  const sub =
    typeof row.subscription === 'string'
      ? (JSON.parse(row.subscription) as PushSubscription)
      : row.subscription;
  try {
    await webpush.sendNotification(
      sub as unknown as webpush.PushSubscription,
      JSON.stringify(payload),
    );
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    logger.error(
      {
        endpoint: `...${row.endpoint.slice(-20)}`,
        status: e.statusCode ?? 'n/a',
        err: e.message,
      },
      'Push delivery failed',
    );
    if (e.statusCode === 410 || e.statusCode === 404 || e.statusCode === 403) {
      removeSubscription(row.endpoint).catch(() => {});
      logger.info(
        { endpoint: `...${row.endpoint.slice(-20)}`, status: e.statusCode },
        'Removed invalid push subscription',
      );
    }
  }
}

// ─── Public delivery helpers ─────────────────────────────────────────────

export async function notifyAll(payload: object, companyId?: number): Promise<void> {
  const res = companyId
    ? await getPool().query<SubscriptionRow>(
        'SELECT endpoint, subscription FROM push_subscriptions WHERE company_id = $1',
        [companyId],
      )
    : await getPool().query<SubscriptionRow>(
        'SELECT endpoint, subscription FROM push_subscriptions',
      );
  await Promise.all(res.rows.map((row) => sendPush(row, payload)));
  logger.info(
    { subscribers: res.rows.length, companyId: companyId ?? null },
    'Push sent to all agents',
  );
}

export async function notifyAgent(agentId: number, payload: object): Promise<void> {
  const res = await getPool().query<SubscriptionRow>(
    'SELECT endpoint, subscription FROM push_subscriptions WHERE agent_id = $1',
    [agentId],
  );
  await Promise.all(res.rows.map((row) => sendPush(row, payload)));
  if (res.rows.length > 0) {
    logger.info({ agentId, subscriptions: res.rows.length }, 'Push sent to agent');
  }
}

export async function notifyAdmins(payload: object, companyId?: number): Promise<void> {
  try {
    const res = companyId
      ? await getPool().query<SubscriptionRow>(
          `SELECT ps.endpoint, ps.subscription
           FROM push_subscriptions ps
           JOIN agents a ON a.id = ps.agent_id
           WHERE a.role = 'admin' AND a.is_active = true AND ps.company_id = $1`,
          [companyId],
        )
      : await getPool().query<SubscriptionRow>(
          `SELECT ps.endpoint, ps.subscription
           FROM push_subscriptions ps
           JOIN agents a ON a.id = ps.agent_id
           WHERE a.role = 'admin' AND a.is_active = true`,
        );
    await Promise.all(res.rows.map((row) => sendPush(row, payload)));
    logger.info({ subscriptions: res.rows.length }, 'Push sent to admins');
  } catch (err) {
    logger.error(
      {
        payloadTitle: (payload as { title?: string })?.title ?? '(none)',
        err: (err as Error)?.message,
      },
      'notifyAdmins failed',
    );
  }
}
