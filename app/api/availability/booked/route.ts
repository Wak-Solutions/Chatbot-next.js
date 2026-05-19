/**
 * GET /api/availability/booked?weekStart=YYYY-MM-DD
 * Port of server/routes/meetings.routes.ts:276-311.
 *
 * Returns already-booked slots for the authed company over a 7-day
 * window. Demo bookings are merged in only for company_id = 1
 * (WAK Solutions) since they share that tenant's calendar — that
 * merge is now the calendar_events view's responsibility, so the
 * tenant filter here naturally excludes demos for any company_id != 1
 * (demos surface in the view with company_id hardcoded to 1).
 *
 * Response: array of `{ date: 'YYYY-MM-DD', time: 'HH:00' }` in KSA-local time.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { KSA_OFFSET_MS } from '@/lib/meetings/timezone';

const logger = createLogger('availability');

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, auth) => {
  try {
    const weekStart =
      new URL(request.url).searchParams.get('weekStart') ??
      new Date().toISOString().slice(0, 10);
    const [yr, mo, dy] = weekStart.split('-').map(Number);
    const weekStartUtc = new Date(Date.UTC(yr, mo - 1, dy + 1, 0, 0, 0) - KSA_OFFSET_MS);
    const weekEndUtc = new Date(weekStartUtc.getTime() + 7 * 24 * 60 * 60 * 1000);

    const result = await getPool().query<{ scheduled_at: Date }>(
      `SELECT scheduled_at FROM calendar_events
       WHERE company_id = $3
         AND scheduled_at >= $1 AND scheduled_at < $2
         AND scheduled_at IS NOT NULL
         AND status NOT IN ('completed', 'cancelled')`,
      [weekStartUtc, weekEndUtc, auth.companyId],
    );

    const rows = result.rows.map((r: { scheduled_at: Date }) => {
      const ksa = new Date(new Date(r.scheduled_at).getTime() + KSA_OFFSET_MS);
      const ksaMidnightUtc = new Date(
        Date.UTC(ksa.getUTCFullYear(), ksa.getUTCMonth(), ksa.getUTCDate()) - KSA_OFFSET_MS,
      );
      const date = ksaMidnightUtc.toISOString().slice(0, 10);
      const time = `${String(ksa.getUTCHours()).padStart(2, '0')}:00`;
      return { date, time };
    });

    return NextResponse.json(rows);
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
      'getBookedSlots failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
