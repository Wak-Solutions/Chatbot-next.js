/**
 * GET /api/agents/workload — port of server/agents.ts:96-125.
 *
 * Per-agent active/resolved/meetings counts. Filtered by company.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agents');

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (_request, auth) => {
  try {
    const result = await getPool().query(
      `
      SELECT
        a.id   AS agent_id,
        a.name,
        a.is_active,
        COUNT(e.customer_phone) FILTER (WHERE e.status = 'open' AND e.company_id = $1)::int  AS active_chats,
        COUNT(e.customer_phone) FILTER (
          WHERE e.status = 'closed' AND e.company_id = $1 AND e.created_at >= CURRENT_DATE
        )::int AS resolved_today,
        COUNT(e.customer_phone) FILTER (
          WHERE e.status = 'closed' AND e.company_id = $1 AND e.created_at >= DATE_TRUNC('week', NOW())
        )::int AS resolved_this_week,
        COUNT(e.customer_phone) FILTER (WHERE e.status = 'closed' AND e.company_id = $1)::int AS total_resolved,
        COUNT(m2.id)::int AS meetings_completed
      FROM agents a
      LEFT JOIN escalations e ON e.assigned_agent_id = a.id
      LEFT JOIN meetings m2 ON m2.agent_id = a.id AND m2.status = 'completed' AND m2.company_id = $1
      WHERE a.company_id = $1
      GROUP BY a.id, a.name, a.is_active
      ORDER BY a.name
      `,
      [auth.companyId],
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    logger.error({ companyId: auth.companyId, err: (err as Error)?.message }, 'getWorkload failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
