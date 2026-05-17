/**
 * GET /api/inbox — port of server/routes/inbox.routes.ts:63-146.
 *
 * Unified feed: active chats (escalations open/in_progress) + upcoming
 * meetings (pending/in_progress), deduped so a customer with both shows
 * up once (chat row with meeting fields attached via LATERAL).
 *
 * Role-scoped meeting_link visibility:
 *   - role === 'admin'   → every row keeps its meeting_link
 *   - other roles        → rows whose meeting_agent_id !== sessionAgentId
 *                          have meeting_link nulled out before the response
 *
 * The two queries return identical column shapes so they merge cleanly.
 * Ordering is by created_at DESC across both result sets.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('inbox');

export const dynamic = 'force-dynamic';

interface InboxRow {
  item_type: 'chat' | 'meeting';
  customer_phone: string;
  escalation_reason: string | null;
  chat_status: string | null;
  created_at: string;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  meeting_id: number | null;
  meeting_scheduled_at: string | null;
  meeting_status: string | null;
  meeting_link: string | null;
  meeting_agent_id: number | null;
  meeting_agent_name: string | null;
}

export const GET = withAuth(async (_request, auth) => {
  const { companyId, agentId, role } = auth;
  try {
    const [escRes, meetRes] = await Promise.all([
      getPool().query<InboxRow>(
        `
        SELECT
          'chat'::text          AS item_type,
          e.customer_phone,
          e.escalation_reason,
          e.status              AS chat_status,
          e.created_at,
          e.assigned_agent_id,
          a.name                AS assigned_agent_name,
          m.id                  AS meeting_id,
          m.scheduled_at        AS meeting_scheduled_at,
          m.status              AS meeting_status,
          m.meeting_link,
          m.agent_id            AS meeting_agent_id,
          ma.name               AS meeting_agent_name
        FROM escalations e
        LEFT JOIN agents a  ON a.id  = e.assigned_agent_id
        LEFT JOIN LATERAL (
          SELECT * FROM meetings
          WHERE customer_phone = e.customer_phone
            AND company_id = $1
            AND scheduled_at IS NOT NULL
            AND status IN ('pending','in_progress')
          ORDER BY scheduled_at ASC LIMIT 1
        ) m ON true
        LEFT JOIN agents ma ON ma.id = m.agent_id
        WHERE e.status IN ('open','in_progress')
          AND e.company_id = $1
        ORDER BY e.created_at DESC
        `,
        [companyId],
      ),
      getPool().query<InboxRow>(
        `
        SELECT
          'meeting'::text       AS item_type,
          m.customer_phone,
          NULL::text            AS escalation_reason,
          NULL::text            AS chat_status,
          m.created_at,
          m.agent_id            AS assigned_agent_id,
          a.name                AS assigned_agent_name,
          m.id                  AS meeting_id,
          m.scheduled_at        AS meeting_scheduled_at,
          m.status              AS meeting_status,
          m.meeting_link,
          m.agent_id            AS meeting_agent_id,
          a.name                AS meeting_agent_name
        FROM meetings m
        LEFT JOIN agents a ON a.id = m.agent_id
        WHERE m.scheduled_at IS NOT NULL
          AND m.company_id = $1
          AND m.status IN ('pending','in_progress')
          AND NOT EXISTS (
            SELECT 1 FROM escalations e
            WHERE e.customer_phone = m.customer_phone
              AND e.company_id = $1
              AND e.status IN ('open','in_progress')
          )
        ORDER BY m.scheduled_at ASC
        `,
        [companyId],
      ),
    ]);

    const isAdmin = role === 'admin';
    const items: InboxRow[] = [...escRes.rows, ...meetRes.rows]
      .sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .map((item) => {
        if (!isAdmin && item.meeting_link !== null && item.meeting_agent_id !== agentId) {
          return { ...item, meeting_link: null };
        }
        return item;
      });

    return NextResponse.json(items);
  } catch (err) {
    logger.error(
      { companyId, agentId, err: (err as Error)?.message },
      'getInbox failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
