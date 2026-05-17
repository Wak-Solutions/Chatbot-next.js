/**
 * PATCH /api/meetings/[id]/complete — port of server/routes/meetings.routes.ts:193-222.
 *
 * DIVERGENCE from PR plan: plan lists POST; original is PATCH; ported as
 * PATCH for client compat. Flagging.
 *
 * PR 9: restored the post-meeting survey trigger via the new
 * @/lib/surveys/service helper, per the PR 8 divergence-log obligation.
 * Call shape matches the legacy site at server/routes/meetings.routes.ts:216.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { sendSurveyToCustomer } from '@/lib/surveys/service';

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
    const companyId = auth.companyId;

    try {
      if (source === 'demo') {
        if (companyId !== 1) {
          return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }
        const result = await getPool().query(
          `UPDATE demo_bookings SET status = 'completed' WHERE id = $1 RETURNING *`,
          [id],
        );
        if (result.rows.length === 0) {
          return NextResponse.json({ message: 'Meeting not found' }, { status: 404 });
        }
        logger.info({ meetingId: id }, 'Demo meeting completed');
        return NextResponse.json(result.rows[0]);
      }

      const result = await getPool().query(
        `UPDATE meetings SET status = 'completed' WHERE id = $1 AND company_id = $2 RETURNING *`,
        [id, companyId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ message: 'Meeting not found' }, { status: 404 });
      }
      const meeting = result.rows[0];
      logger.info({ meetingId: id }, 'Meeting completed');
      // Fire-and-forget NPS survey — same call shape as the legacy
      // server/routes/meetings.routes.ts:216 site.
      sendSurveyToCustomer(meeting.customer_phone, null, null, meeting.id, companyId).catch(
        (e: unknown) =>
          logger.error({ err: (e as Error)?.message }, 'sendSurveyToCustomer failed (non-fatal)'),
      );
      return NextResponse.json(meeting);
    } catch (err) {
      logger.error(
        { meetingId: id, err: (err as Error)?.message },
        'completeMeeting failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
