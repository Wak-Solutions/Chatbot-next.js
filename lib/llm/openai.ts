/**
 * Shared OpenAI client. Lazy singleton so the module loads cleanly when
 * OPENAI_API_KEY isn't set (typecheck / dev without credentials).
 *
 * Reads OPENAI_API_KEY at first call. OPENAI_MODEL is consumed by each
 * caller per-request (different call sites use different models —
 * suggest/generate-conversation today, more in PR 13's worker).
 */

import OpenAI from 'openai';

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}
