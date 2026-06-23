/**
 * GET /api/conversations — port of server/routes/inbox.routes.ts:21-58.
 *
 * Role-scoped visibility:
 *   - role === 'admin'  → sees every conversation in the company
 *   - other roles       → sees only conversations whose latest escalation
 *                         is assigned to them OR is unassigned
 *
 * The SQL filter `($2 OR e.assigned_agent_id = $3 OR e.assigned_agent_id IS NULL)`
 * encodes that rule verbatim — when isAdmin is true the OR short-circuits
 * and the per-agent predicate is never evaluated.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('inbox');

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request, auth) => {
  const { companyId, agentId, role } = auth;
  const isAdmin = role === 'admin';
  try {
    const result = await getPool().query(
      `
      SELECT
        m.customer_phone,
        c.name               AS customer_name,
        (SELECT message_text FROM messages WHERE customer_phone = m.customer_phone AND company_id = $1 ORDER BY created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at  FROM messages WHERE customer_phone = m.customer_phone AND company_id = $1 ORDER BY created_at DESC LIMIT 1) AS last_message_at,
        e.status             AS escalation_status,
        e.escalation_reason,
        e.assigned_agent_id,
        a.name               AS assigned_agent_name
      FROM (SELECT DISTINCT customer_phone FROM messages WHERE company_id = $1) m
      LEFT JOIN LATERAL (
        SELECT status, escalation_reason, assigned_agent_id
        FROM escalations
        WHERE customer_phone = m.customer_phone
          AND company_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      ) e ON true
      LEFT JOIN agents a ON a.id = e.assigned_agent_id
      -- Match on digits-only so a contact saved as "+966 50…" still lines up
      -- with a message phone stored as "96650…" (sanitizePhone format).
      LEFT JOIN contacts c
        ON regexp_replace(c.phone_number, '\\D', '', 'g') = regexp_replace(m.customer_phone, '\\D', '', 'g')
      WHERE 1=1
        AND ($2 OR e.assigned_agent_id = $3 OR e.assigned_agent_id IS NULL)
      ORDER BY last_message_at DESC NULLS LAST
      `,
      [companyId, isAdmin, agentId],
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    logger.error(
      { companyId, agentId, err: (err as Error)?.message },
      'getConversations failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
