/**
 * Trial gate — direct port of server/lib/trial.ts.
 *
 * Trial status is ALWAYS recomputed from companies.created_at +
 * config.trial_days. Never trust the session: a tampered companyId can
 * change which row we look up, but it cannot extend the trial because the
 * decision is made by the DB on every call.
 *
 * Cache: trial_days is read frequently and rarely changes, so it's cached
 * in-process for 30s. The per-company status query is NOT cached.
 */

import { getPool } from '@/lib/db/client';

const DEFAULT_TRIAL_DAYS = 14;
const CACHE_TTL_MS = 30 * 1000;

let cachedTrialDays: { value: number; at: number } | null = null;

export interface TrialStatus {
  trialDays: number;
  createdAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  daysRemaining: number;
}

const TRIAL_EXEMPT_PATHS = new Set<string>([
  '/api/logout',
  '/api/me',
  '/api/me/trial',
  '/api/config/trial-days',
]);

export function isTrialExempt(path: string): boolean {
  return TRIAL_EXEMPT_PATHS.has(path);
}

export async function getTrialDays(): Promise<number> {
  const now = Date.now();
  if (cachedTrialDays && now - cachedTrialDays.at < CACHE_TTL_MS) {
    return cachedTrialDays.value;
  }
  try {
    const r = await getPool().query<{ value: string }>(
      `SELECT value FROM config WHERE key = 'trial_days'`,
    );
    const raw = r.rows[0]?.value;
    const n = Number.parseInt(raw ?? '', 10);
    const v = Number.isFinite(n) && n > 0 ? n : DEFAULT_TRIAL_DAYS;
    cachedTrialDays = { value: v, at: now };
    return v;
  } catch {
    return DEFAULT_TRIAL_DAYS;
  }
}

export async function getCompanyTrialStatus(companyId: number): Promise<TrialStatus> {
  const trialDays = await getTrialDays();
  const r = await getPool().query<{
    created_at: Date | null;
    expires_at: Date | null;
    expired: boolean | null;
    days_remaining: number | null;
  }>(
    `SELECT created_at,
            (created_at + ($1 || ' days')::INTERVAL) AS expires_at,
            NOW() > (created_at + ($1 || ' days')::INTERVAL) AS expired,
            GREATEST(
              0,
              CEIL(EXTRACT(EPOCH FROM ((created_at + ($1 || ' days')::INTERVAL) - NOW())) / 86400)
            )::int AS days_remaining
     FROM companies WHERE id = $2`,
    [String(trialDays), companyId],
  );
  const row = r.rows[0];
  if (!row) {
    return { trialDays, createdAt: null, expiresAt: null, expired: true, daysRemaining: 0 };
  }
  return {
    trialDays,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    expired: Boolean(row.expired),
    daysRemaining: Number(row.days_remaining ?? 0),
  };
}

export async function isCompanyTrialExpired(companyId: number): Promise<boolean> {
  const s = await getCompanyTrialStatus(companyId);
  return s.expired;
}

/**
 * Throws if the company's trial has expired. Used by the Auth.js
 * authorize() callback per Phase 3 spec — Auth.js surfaces the error
 * to the login UI and refuses to issue a session.
 */
export async function checkTrial(companyId: number | null | undefined): Promise<void> {
  if (companyId == null) return;
  if (await isCompanyTrialExpired(companyId)) {
    throw new Error('Trial expired. Please contact support.');
  }
}
