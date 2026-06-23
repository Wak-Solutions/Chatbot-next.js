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

/** Resolve a conversation — close every active ticket it has. */
export async function resolveTicket(customerPhone: string, companyId: number): Promise<void> {
  await getPool().query(
    `UPDATE escalations
        SET status = 'closed'
      WHERE customer_phone = $1 AND company_id = $2 AND status IN ('open', 'in_progress')`,
    [customerPhone, companyId],
  );
}
