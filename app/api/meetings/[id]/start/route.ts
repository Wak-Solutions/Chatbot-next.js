/**
 * PATCH /api/meetings/[id]/start — port of server/routes/meetings.routes.ts:160-190.
 *
 * DIVERGENCE from PR plan: plan lists this as POST. The existing Express
 * handler is PATCH and the dashboard client already sends PATCH —
 * porting as PATCH preserves wire compatibility. Same pattern as the
 * PUT-vs-POST divergences flagged in PR 6. Flagging.
 *
 * Marks a meeting (or demo booking) as in_progress and assigns it to
 * the calling agent. Body: { source?: 'meeting' | 'demo' } (default 'meeting').
 *
 * Demo source requires companyId === 1 (WAK Solutions) per the existing
 * tenancy boundary; demo_bookings has no company_id column.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('meetings');

export const dynamic = 'force-dynamic';

export const PATCH = withCsrf(
  withAuth<{ params: Promise<{ id: string }> }>(async (request, auth, ctx) => {
    const { id } = await ctx.params;
    let body: { source?: string };
    try {
      body = (await request.json()) as { source?: string };
    } catch {
      body = {};
    }
    const source = body.source === 'demo' ? 'demo' : 'meeting';
    const agentId = auth.agentId;
    const companyId = auth.companyId;

    try {
      if (source === 'demo') {
        if (companyId !== 1) {
          return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }
        const result = await getPool().query(
          `UPDATE demo_bookings SET status = 'in_progress', agent_id = $2 WHERE id = $1
           RETURNING *, (SELECT name FROM agents WHERE id = $2) AS agent_name`,
          [id, agentId],
        );
        if (result.rows.length === 0) {
          return NextResponse.json({ message: 'Meeting not found' }, { status: 404 });
        }
        logger.info({ meetingId: id, agentId }, 'Demo meeting started');
        return NextResponse.json(result.rows[0]);
      }

      const result = await getPool().query(
        `UPDATE meetings SET status = 'in_progress', agent_id = $2 WHERE id = $1 AND company_id = $3
         RETURNING meetings.*, (SELECT name FROM agents WHERE id = $2) AS agent_name`,
        [id, agentId, companyId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ message: 'Meeting not found' }, { status: 404 });
      }
      logger.info({ meetingId: id, agentId }, 'Meeting started');
      return NextResponse.json(result.rows[0]);
    } catch (err) {
      logger.error(
        { meetingId: id, err: (err as Error)?.message },
        'startMeeting failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
