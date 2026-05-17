/**
 * GET /api/demo-booking/my-booking — port of server/routes/meetings.routes.ts:655-682.
 *
 * Returns the calling agent's most-recent pending/in_progress demo
 * booking, or { booking: null } if there isn't one.
 *
 * Scope: agent-scoped, not company-scoped (demo_bookings has no
 * company_id). The original endpoint runs through requireAuth and looks
 * up by req.session.agentId.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { KSA_OFFSET_MS, formatKsaDateTime } from '@/lib/meetings/timezone';

const logger = createLogger('demo-booking');

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request, auth) => {
  try {
    const result = await getPool().query<{
      id: number;
      meeting_link: string | null;
      scheduled_at: Date;
      status: string;
    }>(
      `SELECT id, meeting_link, scheduled_at, status
       FROM demo_bookings
       WHERE agent_id = $1
         AND status IN ('pending', 'in_progress')
       ORDER BY created_at DESC
       LIMIT 1`,
      [auth.agentId],
    );
    if (result.rows.length === 0) return NextResponse.json({ booking: null });
    const m = result.rows[0];
    const ksaDt = new Date(new Date(m.scheduled_at).getTime() + KSA_OFFSET_MS);
    return NextResponse.json({
      booking: {
        id: m.id,
        meeting_link: m.meeting_link,
        status: m.status,
        ksa_label: formatKsaDateTime(ksaDt),
      },
    });
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
      'getMyDemoBooking failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
