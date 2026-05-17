/**
 * resolveCompanyBySecret — unified port of
 * server/helpers/resolveCompanyFromSecret.ts and Chatbot/_db_creds.py:40
 * (get_company_by_webhook_secret).
 *
 * Used to authenticate cross-service requests via the x-webhook-secret
 * header — never trusts a caller-supplied company_id. The DB equality
 * check is the comparison (PostgreSQL hashes the column before comparing,
 * and the 32-byte secret space makes brute force infeasible regardless
 * of side-channel timing).
 *
 * Returns the company row or null if the secret is missing, unknown,
 * or belongs to an inactive company.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('resolve-by-secret');

export interface CompanyMinimal {
  id: number;
  name: string;
}

export async function resolveCompanyBySecret(
  secret: string | undefined | null,
): Promise<CompanyMinimal | null> {
  if (!secret) return null;
  try {
    const result = await getPool().query<{ id: number; name: string }>(
      `SELECT id, name FROM companies
       WHERE webhook_secret = $1 AND is_active = true
       LIMIT 1`,
      [secret],
    );
    if (result.rows.length === 0) {
      logger.warn('Webhook secret did not match any active company');
      return null;
    }
    const row = result.rows[0];
    return { id: row.id, name: row.name };
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'resolveCompanyBySecret failed');
    return null;
  }
}
