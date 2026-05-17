/**
 * Per-company system-prompt cache + loader.
 *
 * Port of Chatbot/_prompt_cache.py. 60-second TTL — same as the legacy
 * value. The dashboard's POST /api/chatbot-config calls
 * invalidatePromptCache(companyId) after saving so admins see their
 * edits take effect immediately instead of waiting for the TTL.
 *
 * On DB miss or DB error: fall back to the cached value if one exists,
 * else DEFAULT_SYSTEM_PROMPT.
 *
 * getSystemPrompt(companyId, currentMessage) appends a language
 * override suffix derived from currentMessage's script, so the model
 * doesn't get fooled by an Arabic history when the customer just
 * switched to English (or vice versa).
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { DEFAULT_SYSTEM_PROMPT } from './default';
import { LANGUAGE_OVERRIDE, detectLanguage } from './language';

const logger = createLogger('prompt-cache');

const CACHE_TTL_MS = 60_000;
const cache: Map<number, { prompt: string; at: number }> = new Map();

export async function getSystemPrompt(
  companyId: number,
  currentMessage = '',
): Promise<string> {
  const now = Date.now();
  const cached = cache.get(companyId);
  let prompt: string;

  if (cached && now - cached.at < CACHE_TTL_MS) {
    prompt = cached.prompt;
  } else {
    try {
      const r = await getPool().query<{ system_prompt: string | null }>(
        'SELECT system_prompt FROM chatbot_config WHERE company_id = $1 ORDER BY id LIMIT 1',
        [companyId],
      );
      const row = r.rows[0];
      if (row && row.system_prompt) {
        cache.set(companyId, { prompt: row.system_prompt, at: now });
        logger.info({ companyId }, 'System prompt refreshed from database');
        prompt = row.system_prompt;
      } else {
        throw new Error('no system_prompt row');
      }
    } catch (err) {
      logger.warn(
        { companyId, err: (err as Error)?.message },
        'Could not load system prompt from DB — using cached/default',
      );
      prompt = cached?.prompt ?? DEFAULT_SYSTEM_PROMPT;
      if (!cached) {
        logger.info({ companyId }, 'Using hardcoded default system prompt');
      }
    }
  }

  if (currentMessage.trim()) {
    const lang = detectLanguage(currentMessage);
    if (lang) {
      prompt = prompt + LANGUAGE_OVERRIDE.replaceAll('{language}', lang);
    }
  }
  return prompt;
}

/**
 * Invalidate the cache so the next `getSystemPrompt` reloads from the
 * DB. Pass a companyId to clear only that tenant, omit to clear all.
 *
 * Called from POST /api/chatbot-config in dashboard-next after every
 * config save (PR 9). The cache TTL is still 60s for the unseen-by-the-
 * dashboard case (worker restarts, DB-direct edits) — this hook just
 * makes admin saves immediate.
 */
export function invalidatePromptCache(companyId?: number): void {
  if (companyId === undefined) {
    cache.clear();
    logger.info('Prompt cache fully invalidated');
  } else {
    cache.delete(companyId);
    logger.info({ companyId }, 'Prompt cache invalidated');
  }
}
