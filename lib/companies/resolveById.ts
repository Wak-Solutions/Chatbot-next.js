/**
 * resolveCompanyById — fetch a company row by id, cached in-process.
 *
 * Cache: 30s TTL, capped at 1000 entries. Long enough to amortize the
 * lookup cost for hot paths (webhook + send), short enough that an
 * admin renaming the brand or flipping is_active is reflected quickly.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('resolve-by-id');

const CACHE_TTL_MS = 30_000;
const MAX_CACHE = 1_000;

export interface Company {
  id: number;
  name: string;
  app_url: string | null;
  brand_name: string | null;
  is_active: boolean | null;
}

const cache = new Map<number, { value: Company | null; at: number }>();

export function invalidateCompanyById(id: number): void {
  cache.delete(id);
}

export async function resolveCompanyById(id: number): Promise<Company | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const now = Date.now();
  const cached = cache.get(id);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const r = await getPool().query<Company>(
      'SELECT id, name, app_url, brand_name, is_active FROM companies WHERE id = $1 LIMIT 1',
      [id],
    );
    const value = r.rows[0] ?? null;
    cache.set(id, { value, at: now });
    if (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  } catch (err) {
    logger.error({ id, err: (err as Error)?.message }, 'resolveCompanyById failed');
    return null;
  }
}
