/**
 * resolveCompanyByGupshupApp — the Gupshup analogue of
 * resolveCompanyByPhoneNumberId.
 *
 * Gupshup identifies the destination by the `app` field in the inbound
 * webhook envelope (the Gupshup app name), NOT by a phone_number_id. We map
 * that to a company via companies.gupshup_app_name.
 *
 * Cached in-process for 30s, successes only (a company may register a new
 * app name at any time). Returns null when no active company owns the app —
 * the caller MUST discard the message; routing unrouted webhooks to a
 * default company causes cross-tenant data leakage.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('resolve-by-gupshup-app');

const CACHE_TTL_MS = 30_000;
const MAX_CACHE = 1_000;

const cache = new Map<string, { value: number; at: number }>();

export async function resolveCompanyByGupshupApp(
  appName: string,
): Promise<number | null> {
  if (!appName) return null;
  const now = Date.now();
  const cached = cache.get(appName);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const r = await getPool().query<{ id: number }>(
      `SELECT id FROM companies
       WHERE gupshup_app_name = $1 AND is_active = true
       LIMIT 1`,
      [appName],
    );
    if (r.rows.length === 0) {
      logger.error(
        { appName },
        'Unroutable Gupshup webhook — no active company owns this app name. Message discarded. Set companies.gupshup_app_name for this tenant.',
      );
      return null;
    }
    const companyId = r.rows[0].id;
    logger.info({ companyId, appName }, 'Resolved company_id for Gupshup app');
    cache.set(appName, { value: companyId, at: now });
    if (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return companyId;
  } catch (err) {
    logger.error(
      { appName, err: (err as Error)?.message },
      'resolveCompanyByGupshupApp DB error',
    );
    throw err;
  }
}

export function invalidateCompanyByGupshupApp(appName: string): void {
  cache.delete(appName);
}
