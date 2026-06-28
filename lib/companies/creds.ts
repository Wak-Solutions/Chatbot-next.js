/**
 * Per-company WhatsApp credentials. NO in-process cache.
 *
 * Shape returned matches Chatbot/_db_creds.py:8 get_company_whatsapp_creds:
 *   { token, phoneId, appSecret }
 *
 * NOTE on caching: the Python equivalent at Chatbot/_db_creds.py:14
 * explicitly removed its in-process cache after a token-rotation incident
 * caused Meta error 190 ("token expired") storms in production. An earlier
 * draft of this module reintroduced a 30s cache with invalidate-on-401
 * mitigation, but that mitigation still costs one failed send per rotation
 * per replica per stale window — not acceptable given the production
 * evidence. We now read from the DB on every call. The query is keyed on
 * an indexed primary-key column (companies.id) or whatsapp_phone_number_id
 * (also indexed via the implicit index on the lookup path), so the per-call
 * cost is negligible.
 *
 * `invalidateWhatsappCreds` is retained as a no-op so existing callers
 * (e.g. the 401/190 unhappy path in /api/send) compile and remain
 * readable. It will silently do nothing.
 *
 * Also exposes lookupAppSecretByPhoneNumberId for inbound webhook signature
 * verification — port of Chatbot/_db_creds.py:128.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('creds');

export interface WhatsappCreds {
  token: string;
  phoneId: string;
  appSecret: string | null;
}

export interface GupshupCreds {
  apiKey: string;
  appName: string;
  /** Sending WhatsApp business number. */
  source: string;
}

/**
 * Per-company Gupshup send credentials. Same no-cache rationale as
 * getWhatsappCreds — read from the DB on every call so a rotated key never
 * lingers. Returns null when the company isn't configured for Gupshup.
 */
export async function getGupshupCreds(companyId: number): Promise<GupshupCreds | null> {
  if (!Number.isInteger(companyId) || companyId <= 0) return null;
  try {
    const r = await getPool().query<{
      gupshup_api_key: string | null;
      gupshup_app_name: string | null;
      gupshup_source_number: string | null;
    }>(
      'SELECT gupshup_api_key, gupshup_app_name, gupshup_source_number FROM companies WHERE id = $1',
      [companyId],
    );
    const row = r.rows[0];
    if (!row || !row.gupshup_api_key || !row.gupshup_app_name || !row.gupshup_source_number) {
      logger.error({ companyId }, 'Company has no Gupshup credentials configured');
      return null;
    }
    return {
      apiKey: row.gupshup_api_key,
      appName: row.gupshup_app_name,
      source: row.gupshup_source_number,
    };
  } catch (err) {
    logger.error({ companyId, err: (err as Error)?.message }, 'getGupshupCreds failed');
    return null;
  }
}

/**
 * No-op retained for caller compatibility. The cache it used to invalidate
 * was removed — see the file header for why. Safe to call; safe to remove
 * entirely once no caller references it.
 */
export function invalidateWhatsappCreds(_companyId: number): void {
  // intentional no-op
}

export async function getWhatsappCreds(companyId: number): Promise<WhatsappCreds | null> {
  if (!Number.isInteger(companyId) || companyId <= 0) return null;
  try {
    const r = await getPool().query<{
      whatsapp_token: string | null;
      whatsapp_phone_number_id: string | null;
      whatsapp_app_secret: string | null;
    }>(
      'SELECT whatsapp_token, whatsapp_phone_number_id, whatsapp_app_secret FROM companies WHERE id = $1',
      [companyId],
    );
    const row = r.rows[0];
    if (!row || !row.whatsapp_token || !row.whatsapp_phone_number_id) {
      logger.error({ companyId }, 'Company has no WhatsApp credentials configured');
      return null;
    }
    return {
      token: row.whatsapp_token,
      phoneId: row.whatsapp_phone_number_id,
      appSecret: row.whatsapp_app_secret,
    };
  } catch (err) {
    logger.error(
      { companyId, err: (err as Error)?.message },
      'getWhatsappCreds failed',
    );
    return null;
  }
}

/**
 * Returns the Meta App Secret for the company that owns this phone_number_id.
 * Used to verify inbound webhook signatures per-company.
 *
 * Returns null when no matching row exists. Re-raises on DB error so
 * callers can distinguish "unknown phone_number_id" (a security event —
 * return 403) from "transient DB failure" (operational — return 200 so
 * Meta does not retry the same webhook in a storm). Matches the
 * separation at Chatbot/_db_creds.py:128.
 */
export async function lookupAppSecretByPhoneNumberId(
  phoneNumberId: string,
): Promise<string | null> {
  if (!phoneNumberId) return null;
  try {
    const r = await getPool().query<{ whatsapp_app_secret: string | null }>(
      'SELECT whatsapp_app_secret FROM companies WHERE whatsapp_phone_number_id = $1 LIMIT 1',
      [phoneNumberId],
    );
    return r.rows[0]?.whatsapp_app_secret ?? null;
  } catch (err) {
    logger.error(
      { phoneNumberId, err: (err as Error)?.message },
      'lookupAppSecretByPhoneNumberId failed',
    );
    throw err;
  }
}
