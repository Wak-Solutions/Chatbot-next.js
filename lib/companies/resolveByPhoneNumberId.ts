/**
 * resolveCompanyByPhoneNumberId — port of Chatbot/_db_companies.py:59
 * (get_company_by_phone_number_id).
 *
 * Looks up the company_id that owns a Meta WhatsApp phone_number_id.
 * Cached in-process for 30s (matches Python's _COMPANY_CACHE_TTL). The
 * cache holds only successful resolutions — None is NOT cached, since
 * a company may register a previously-unknown phone_number_id at any
 * time.
 *
 * Returns null if no active company owns this phone_number_id. The
 * caller MUST treat null as "discard the message" — silently routing
 * unrouted webhooks to a default company causes cross-tenant data leakage.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('resolve-by-pnid');

const CACHE_TTL_MS = 30_000;
const MAX_CACHE = 1_000;

const cache = new Map<string, { value: number; at: number }>();

export async function resolveCompanyByPhoneNumberId(
  phoneNumberId: string,
): Promise<number | null> {
  if (!phoneNumberId) return null;
  const now = Date.now();
  const cached = cache.get(phoneNumberId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const r = await getPool().query<{ id: number }>(
      `SELECT id FROM companies
       WHERE whatsapp_phone_number_id = $1 AND is_active = true
       LIMIT 1`,
      [phoneNumberId],
    );
    if (r.rows.length === 0) {
      logger.error(
        { phoneNumberId },
        'Unroutable webhook — no active company owns phone_number_id. Message will be discarded. Register this number in the company\'s WhatsApp settings.',
      );
      return null;
    }
    const companyId = r.rows[0].id;
    logger.info({ companyId, phoneNumberId }, 'Resolved company_id for phone_number_id');
    cache.set(phoneNumberId, { value: companyId, at: now });
    if (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return companyId;
  } catch (err) {
    logger.error(
      { phoneNumberId, err: (err as Error)?.message },
      'resolveCompanyByPhoneNumberId DB error',
    );
    throw err;
  }
}

export function invalidateCompanyByPhoneNumberId(phoneNumberId: string): void {
  cache.delete(phoneNumberId);
}
