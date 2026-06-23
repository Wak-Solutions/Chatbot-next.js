/**
 * Conversation "tickets" — the claim/resolve lifecycle, stored in the
 * escalations table (one row per handoff/claim). Status model:
 *
 *   'open'        → unclaimed (AI forwarded it because the customer asked for
 *                   a human) — shows in the Unclaimed inbox.
 *   'in_progress' → claimed by an agent (assigned_agent_id set) — My/Claimed.
 *   'closed'      → resolved — Resolved inbox.
 *
 * Every conversation still appears in the Shared inbox regardless of whether
 * it has a ticket (that list is derived from messages). A ticket only exists
 * once a chat is forwarded or claimed.
 */

import { getPool } from '@/lib/db/client';
import { setAiPaused } from './pauseState';

/**
 * Create an unclaimed ticket for a conversation if it doesn't already have an
 * active one. Called when the AI forwards a customer to a human.
 */
export async function ensureUnclaimedTicket(
  customerPhone: string,
  companyId: number,
  reason: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO escalations (customer_phone, company_id, status, escalation_reason, created_at)
     SELECT $1, $2, 'open', $3, NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM escalations
       WHERE customer_phone = $1 AND company_id = $2 AND status IN ('open', 'in_progress')
     )`,
    [customerPhone, companyId, reason],
  );
}

/**
 * Claim a conversation for an agent. Updates the latest active ticket, or
 * creates one if the chat was claimed straight from the Shared inbox without
 * a prior handoff.
 */
export async function claimTicket(
  customerPhone: string,
  companyId: number,
  agentId: number,
): Promise<void> {
  const pool = getPool();
  const updated = await pool.query(
    `UPDATE escalations
        SET assigned_agent_id = $3, status = 'in_progress'
      WHERE id = (
        SELECT id FROM escalations
        WHERE customer_phone = $1 AND company_id = $2 AND status IN ('open', 'in_progress')
        ORDER BY created_at DESC
        LIMIT 1
      )`,
    [customerPhone, companyId, agentId],
  );
  if ((updated.rowCount ?? 0) === 0) {
    await pool.query(
      `INSERT INTO escalations
         (customer_phone, company_id, status, assigned_agent_id, escalation_reason, created_at)
       VALUES ($1, $2, 'in_progress', $3, 'agent_claimed', NOW())`,
      [customerPhone, companyId, agentId],
    );
  }
}

/**
 * If the company is on auto-assign, hand a just-created ticket to the
 * available agent with the fewest OPEN chats (open = the customer messaged
 * within the last 24h; older chats are past Meta's window and don't count),
 * and pause the AI. No-op when auto-assign is off or no agent is available —
 * the chat then stays in the Unclaimed inbox.
 */
export async function maybeAutoAssign(customerPhone: string, companyId: number): Promise<void> {
  const pool = getPool();
  const cfg = await pool.query<{ auto_assign: boolean | null }>(
    'SELECT auto_assign FROM companies WHERE id = $1',
    [companyId],
  );
  if (!cfg.rows[0]?.auto_assign) return;

  const pick = await pool.query<{ id: number }>(
    `SELECT a.id
       FROM agents a
       LEFT JOIN escalations e
         ON e.assigned_agent_id = a.id AND e.company_id = $1
      WHERE a.company_id = $1 AND a.is_active = true AND a.is_available = true
      GROUP BY a.id
      ORDER BY COUNT(e.id) FILTER (
        WHERE e.status = 'in_progress'
          AND EXISTS (
            SELECT 1 FROM messages m
            WHERE m.customer_phone = e.customer_phone AND m.company_id = $1
              AND m.direction = 'inbound' AND m.created_at > NOW() - INTERVAL '24 hours'
          )
      ) ASC, a.id ASC
      LIMIT 1`,
    [companyId],
  );
  const agentId = pick.rows[0]?.id;
  if (!agentId) return; // nobody available → leave it in Unclaimed

  await claimTicket(customerPhone, companyId, agentId);
  await setAiPaused(customerPhone, companyId, agentId, true);
}

/** Resolve a conversation — close every active ticket it has. */
export async function resolveTicket(customerPhone: string, companyId: number): Promise<void> {
  await getPool().query(
    `UPDATE escalations
        SET status = 'closed'
      WHERE customer_phone = $1 AND company_id = $2 AND status IN ('open', 'in_progress')`,
    [customerPhone, companyId],
  );
}
