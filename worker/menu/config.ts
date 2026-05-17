/**
 * Per-company menuConfig loader with a 60-second TTL cache.
 * Port of Chatbot/menu/_config.py.
 *
 * Reads `chatbot_config.structured_config.menuConfig` for the company.
 * Falls back to the cached value on transient DB errors so the menu
 * navigator keeps working through brief Postgres blips. Returns [] when
 * no menu is configured (the navigator no-ops and the OpenAI path
 * handles the turn).
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('menu-config');

const CACHE_TTL_MS = 60_000;

export interface MenuNode {
  label: string;
  // Children can be either strings (leaf labels) or nested nodes.
  subItems?: Array<string | MenuNode>;
}

const cache: Map<number, { items: MenuNode[]; at: number }> = new Map();

export async function loadMenuConfig(companyId: number): Promise<MenuNode[]> {
  const now = Date.now();
  const cached = cache.get(companyId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.items;

  try {
    const r = await getPool().query<{ structured_config: unknown }>(
      'SELECT structured_config FROM chatbot_config WHERE company_id = $1 ORDER BY id LIMIT 1',
      [companyId],
    );
    const row = r.rows[0];
    if (row && row.structured_config) {
      let cfg = row.structured_config as { menuConfig?: MenuNode[] };
      if (typeof cfg === 'string') {
        try {
          cfg = JSON.parse(cfg) as { menuConfig?: MenuNode[] };
        } catch {
          cfg = {};
        }
      }
      const items = cfg.menuConfig ?? [];
      cache.set(companyId, { items, at: now });
      logger.info(
        { companyId, topLevel: items.length },
        'menuConfig loaded',
      );
      return items;
    }
  } catch (err) {
    logger.warn(
      { companyId, err: (err as Error)?.message },
      'Could not load menuConfig — using cached or empty',
    );
  }
  return cached?.items ?? [];
}

export function invalidateMenuConfig(companyId?: number): void {
  if (companyId === undefined) cache.clear();
  else cache.delete(companyId);
}
