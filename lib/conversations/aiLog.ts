/**
 * Persistent per-company log of each AI exchange — the queryable record
 * that Pino's ephemeral output can't provide.
 *
 * Written from worker/orchestrator/getReply via logAiTurn(). company_id
 * ALWAYS comes from the worker context (caller), never from user input.
 *
 * Fail-soft: a logging failure must never break the reply path, so every
 * error is swallowed and surfaced via Pino only.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai-log');

export type AiTurnStatus = 'complete' | 'hand-off' | 'in_progress';

export interface AiTurnUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LogAiTurnInput {
  companyId: number;
  customerPhone: string;
  conversationId?: string | null;
  userMessage: string;
  /** null for a pure hand-off where the AI yields without a reply. */
  response: string | null;
  status: AiTurnStatus;
  /** null for deterministic replies (menu / booking / hand-off). */
  model?: string | null;
  usage?: AiTurnUsage | null;
}

export async function logAiTurn(input: LogAiTurnInput): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO ai_message_logs
         (company_id, customer_phone, conversation_id, user_message,
          ai_response, status, model, prompt_tokens, completion_tokens, total_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.companyId,
        input.customerPhone,
        input.conversationId ?? null,
        input.userMessage,
        input.response,
        input.status,
        input.model ?? null,
        input.usage?.promptTokens ?? null,
        input.usage?.completionTokens ?? null,
        input.usage?.totalTokens ?? null,
      ],
    );
  } catch (err) {
    logger.warn(
      { companyId: input.companyId, err: (err as Error)?.message },
      'logAiTurn failed (non-fatal)',
    );
  }
}
