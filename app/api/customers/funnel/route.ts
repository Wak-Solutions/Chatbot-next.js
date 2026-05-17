/**
 * GET /api/customers/funnel — port of server/routes/customers.routes.ts:97-122.
 *
 * DIVERGENCE: plan says withAuth, original uses requireAdmin. Preserving
 * admin-only. Flagged.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('customers');

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (_request, auth) => {
  const companyId = auth.companyId;
  try {
    const result = await getPool().query(
      `
      SELECT
        (SELECT COUNT(DISTINCT customer_phone) FROM messages WHERE company_id = $1)                                AS first_contact,
        (SELECT COUNT(DISTINCT customer_phone) FROM messages WHERE company_id = $1 AND sender IN ('ai','agent'))   AS bot_conversation,
        (SELECT COUNT(DISTINCT customer_phone) FROM escalations WHERE company_id = $1)                             AS escalated,
        (SELECT COUNT(DISTINCT customer_phone) FROM meetings WHERE company_id = $1)                                AS meeting_booked,
        (SELECT COUNT(DISTINCT customer_phone) FROM survey_responses WHERE company_id = $1 AND submitted = true)   AS survey_submitted
      `,
      [companyId],
    );
    const r = result.rows[0];
    return NextResponse.json({
      stages: [
        { stage: 'First Contact', count: Number(r.first_contact) },
        { stage: 'Bot Conversation', count: Number(r.bot_conversation) },
        { stage: 'Escalated to Agent', count: Number(r.escalated) },
        { stage: 'Meeting Booked', count: Number(r.meeting_booked) },
        { stage: 'Survey Submitted', count: Number(r.survey_submitted) },
      ],
    });
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
      'getFunnel failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
