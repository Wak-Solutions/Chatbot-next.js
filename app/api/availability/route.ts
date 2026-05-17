/**
 * GET /api/availability?weekStart=YYYY-MM-DD
 * Port of server/routes/meetings.routes.ts:225-242.
 *
 * Returns the list of blocked slots for the authed company over a 7-day
 * window starting at weekStart (defaults to today). Each row is
 * `{ date: 'YYYY-MM-DD', time: 'HH:MM' }`.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('availability');

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, auth) => {
  try {
    const weekStart =
      new URL(request.url).searchParams.get('weekStart') ??
      new Date().toISOString().slice(0, 10);
    const result = await getPool().query(
      `SELECT date::text, time FROM blocked_slots
       WHERE company_id = $1
         AND date >= $2::date AND date < $2::date + INTERVAL '7 days'
       ORDER BY date, time`,
      [auth.companyId, weekStart],
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
      'getAvailability failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
