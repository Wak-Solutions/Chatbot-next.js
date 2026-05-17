/**
 * GET /api/meetings?filter=upcoming|completed|all
 * Port of server/routes/meetings.routes.ts:120-157.
 *
 * Returns the unioned meetings + demo_bookings feed for the authed
 * company. Demo rows are only included for company_id = 1 (WAK
 * Solutions — the platform owner) via the `WHERE $1 = 1` predicate.
 *
 * filter values:
 *   "upcoming"  → status IN ('pending','in_progress')
 *   "completed" → status = 'completed'
 *   anything else → no status filter (default "all")
 *
 * Response rows carry a `source` discriminator ('meeting' or 'demo') so
 * the client can route to the right detail page.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('meetings');

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, auth) => {
  try {
    const filter = new URL(request.url).searchParams.get('filter') ?? 'all';
    let statusFilter = '';
    if (filter === 'upcoming') statusFilter = " AND status IN ('pending', 'in_progress')";
    else if (filter === 'completed') statusFilter = " AND status = 'completed'";

    const result = await getPool().query(
      `SELECT m.id::integer, m.company_id::integer, m.agent_id::integer,
              a.name AS agent_name,
              m.customer_phone::text, NULL::text AS customer_name,
              m.customer_email::text, m.meeting_link::text,
              m.meeting_token::text,
              m.agreed_time::text, m.scheduled_at, m.status::text,
              m.created_at, 'meeting'::text AS source
       FROM meetings m
       LEFT JOIN agents a ON a.id = m.agent_id
       WHERE m.company_id = $1${statusFilter}
       UNION ALL
       SELECT d.id::integer, 1::integer AS company_id, d.agent_id::integer,
              a.name AS agent_name,
              NULL::text AS customer_phone, d.customer_name::text,
              d.customer_email::text, d.meeting_link::text,
              d.meeting_token::text,
              NULL::text AS agreed_time, d.scheduled_at, d.status::text,
              d.created_at, 'demo'::text AS source
       FROM demo_bookings d
       LEFT JOIN agents a ON a.id = d.agent_id
       WHERE $1 = 1${statusFilter}
       ORDER BY scheduled_at DESC NULLS LAST`,
      [auth.companyId],
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
      'listMeetings failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
