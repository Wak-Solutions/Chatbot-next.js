/**
 * Per-(customer_phone, company_id) AI pause state.
 *
 * isPauseActive() is called on every inbound message by worker/orchestrator/
 * getReply. Auto-expire is a read-time timestamp check (paused_at + 1h) —
 * no background job clears the row. The next manual toggle or read past
 * the TTL is what marks the conversation as effectively unpaused.
 */

import { getPool } from '@/lib/db/client';

export const PAUSE_TTL_MS = 60 * 60 * 1000;

export interface PauseStateRow {
  ai_paused: boolean;
  paused_at: Date | null;
  paused_by_agent_id: number | null;
}

export async function getPauseState(
  customerPhone: string,
  companyId: number,
): Promise<PauseStateRow | null> {
  const r = await getPool().query<PauseStateRow>(
    `SELECT ai_paused, paused_at, paused_by_agent_id
       FROM conversation_ai_state
      WHERE customer_phone = $1 AND company_id = $2`,
    [customerPhone, companyId],
  );
  return r.rows[0] ?? null;
}

export function isPauseActive(row: PauseStateRow | null, nowMs: number = Date.now()): boolean {
  if (!row || !row.ai_paused || !row.paused_at) return false;
  const age = nowMs - new Date(row.paused_at).getTime();
  return age >= 0 && age < PAUSE_TTL_MS;
}

/**
 * Set the AI pause flag for a conversation. Shared by the pause toggle, the
 * claim flow (auto-pause when an agent takes over), and resolve (resume).
 */
export async function setAiPaused(
  customerPhone: string,
  companyId: number,
  agentId: number | null,
  paused: boolean,
): Promise<void> {
  if (paused) {
    await getPool().query(
      `INSERT INTO conversation_ai_state
         (customer_phone, company_id, ai_paused, paused_at, paused_by_agent_id, updated_at)
       VALUES ($1, $2, true, NOW(), $3, NOW())
       ON CONFLICT (customer_phone, company_id) DO UPDATE
         SET ai_paused = true, paused_at = NOW(), paused_by_agent_id = $3, updated_at = NOW()`,
      [customerPhone, companyId, agentId],
    );
  } else {
    await getPool().query(
      `INSERT INTO conversation_ai_state
         (customer_phone, company_id, ai_paused, paused_at, paused_by_agent_id, updated_at)
       VALUES ($1, $2, false, NULL, NULL, NOW())
       ON CONFLICT (customer_phone, company_id) DO UPDATE
         SET ai_paused = false, paused_at = NULL, paused_by_agent_id = NULL, updated_at = NOW()`,
      [customerPhone, companyId],
    );
  }
}
