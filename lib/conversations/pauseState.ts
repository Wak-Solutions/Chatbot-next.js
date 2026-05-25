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
