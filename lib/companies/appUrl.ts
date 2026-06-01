/**
 * getCompanyAppUrl — return companies.app_url for a tenant, or null.
 *
 * Differs from getCompanyBranding (lib/notifications/email.ts): branding
 * throws if either app_url or brand_name is missing. This helper is
 * surgical — used by the worker's audio task to build the voice-note
 * download URL (`<app_url>/api/voice-notes/<id>`). If app_url is unset,
 * caller logs and skips persisting the media_url, rather than aborting
 * the whole audio reply.
 */

import { getPool } from '@/lib/db/client';

export async function getCompanyAppUrl(companyId: number): Promise<string | null> {
  if (!Number.isInteger(companyId) || companyId <= 0) return null;
  try {
    const r = await getPool().query<{ app_url: string | null }>(
      'SELECT app_url FROM companies WHERE id = $1 LIMIT 1',
      [companyId],
    );
    const v = r.rows[0]?.app_url;
    return v ? v.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}
